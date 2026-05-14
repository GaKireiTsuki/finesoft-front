# 6. HTTP client

`HttpClient` is a thin, typed wrapper over `fetch` that gives you:

- Class-based subclassing for organizing API surface
- Request/response interceptors for auth, logging, retries
- Structured `HttpError` instead of opaque rejections
- Case-insensitive header handling that matches `Response.headers.get()` semantics

It is **not** an attempt to be axios. It is a sharp small tool aimed at the framework's needs.

## Subclassing

The intended usage is to subclass for each logical API surface:

```ts
import { HttpClient } from "@finesoft/front";

interface User {
    id: string;
    name: string;
}

interface NewUser {
    name: string;
    email: string;
}

export class UserApi extends HttpClient {
    async list(): Promise<User[]> {
        return this.get<User[]>("/users");
    }

    async getById(id: string): Promise<User> {
        return this.get<User>(`/users/${id}`);
    }

    async create(data: NewUser): Promise<User> {
        return this.post<User>("/users", data);
    }

    async update(id: string, data: Partial<NewUser>): Promise<User> {
        return this.patch<User>(`/users/${id}`, data);
    }

    async delete(id: string): Promise<void> {
        await this.delete(`/users/${id}`);
    }
}
```

Each subclass instance binds a `baseUrl` and shared options.

## Instantiation

```ts
const api = new UserApi({
    baseUrl: "/api",
    defaultHeaders: {
        "X-App-Version": "1.0.0",
    },
});
```

Register in DI so controllers can resolve it:

```ts
import { DEP_KEYS } from "@finesoft/front";

container.register("userApi", () => new UserApi({ baseUrl: "/api" }));
```

Then in a controller:

```ts
async execute(params, container) {
    const api = container.resolve<UserApi>("userApi");
    const users = await api.list();
    return { kind: "users", items: users };
}
```

## Methods

| Method                            | HTTP verb | Body? |
| --------------------------------- | --------- | ----- |
| `get<T>(path, options?)`          | GET       | no    |
| `post<T>(path, body?, options?)`  | POST      | yes   |
| `put<T>(path, body?, options?)`   | PUT       | yes   |
| `patch<T>(path, body?, options?)` | PATCH     | yes   |
| `delete<T>(path, options?)`       | DELETE    | no    |

All methods return `Promise<T>`. The response body is parsed based on `Content-Type`:

- `application/json` → `JSON.parse`
- `text/*` → `string`
- everything else → `Response` (you handle parsing)

## Per-request options

```ts
await api.get<User>("/users/42", {
    headers: { "X-Request-Id": requestId },
    signal: abortController.signal,
    credentials: "include",
});
```

All standard `RequestInit` fields pass through. Per-request headers merge with `defaultHeaders` (per-request wins on key conflict).

## Interceptors

### Request interceptors

Transform the URL and `RequestInit` before the request is sent.

```ts
const api = new UserApi({
    baseUrl: "/api",
    requestInterceptors: [
        (url, init) => {
            init.headers = {
                ...init.headers,
                Authorization: `Bearer ${getToken()}`,
            };
            return init;
        },
    ],
});
```

Multiple interceptors run in array order. Each one receives the `init` returned by the previous one.

### Response interceptors

Inspect the `Response` after `fetch` resolves but before the body is parsed.

```ts
new UserApi({
    baseUrl: "/api",
    responseInterceptors: [
        async (response, url) => {
            if (response.status === 401) {
                await refreshToken();
                // optionally re-throw to trigger a retry in your own code
            }
            return response;
        },
    ],
});
```

Returning a different `Response` lets you replace the response (e.g., serve from cache on 5xx).

### Adding interceptors dynamically

```ts
api.useRequestInterceptor((url, init) => {
    init.headers = { ...init.headers, "X-Trace-Id": traceId };
    return init;
});

api.useResponseInterceptor((resp) => {
    metrics.recordLatency(resp.url, performance.now() - start);
    return resp;
});
```

Use this for cross-cutting concerns that aren't known at construction time.

## Error handling

`HttpClient` throws `HttpError` for non-2xx responses:

```ts
import { HttpError } from "@finesoft/front";

try {
    const user = await api.getById("missing");
} catch (e) {
    if (e instanceof HttpError) {
        e.status; // 404
        e.statusText; // "Not Found"
        e.url; // "/api/users/missing"
        e.body; // unknown — parsed response body if available
    }
}
```

Network errors (DNS, refused connection, abort) come through as standard `TypeError` / `DOMException`, not `HttpError`. Catch both if you care about either:

```ts
try {
    await api.list();
} catch (e) {
    if (e instanceof HttpError) {
        if (e.status >= 500) showRetryBanner();
        else showInputError(e.body);
    } else {
        showOfflineBanner();
    }
}
```

## Server-side vs browser

`HttpClient` uses `fetch` directly, which is now native on Node 22+. No platform-specific code is needed.

Browser-side requests can hit:

- Your framework's own proxy routes (`/api/*` → upstream via `proxies` config)
- Public origins directly (with CORS configured upstream)

Server-side requests typically hit:

- Internal services on the private network
- The proxy upstream directly (skipping the proxy hop on SSR)

If you proxy `/api` to `https://upstream.example` and a controller calls `api.get("/api/users")` during SSR, the request goes through your proxy on the way back out to the network — which is wasteful. Configure the API client with `baseUrl: process.env.UPSTREAM_URL` on the server and `baseUrl: "/api"` in the browser, deciding by `framework.platform.isServer`.

## Retries

The framework does not ship a retry interceptor. Wrap your client:

```ts
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (e) {
            if (i === attempts - 1) throw e;
            if (e instanceof HttpError && e.status < 500) throw e; // don't retry 4xx
            await new Promise((r) => setTimeout(r, 2 ** i * 200));
        }
    }
    throw new Error("unreachable");
}

const user = await withRetry(() => api.getById(id));
```

Add this as a wrapper rather than an interceptor — interceptors run once per request, and retry logic needs to re-run the entire request including all earlier interceptors.

## Abort and timeouts

Use `AbortController`:

```ts
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);

try {
    const user = await api.getById(id, { signal: controller.signal });
} finally {
    clearTimeout(timeout);
}
```

For controllers that may navigate away mid-fetch, store the controller and abort in `fallback()` cleanup or on the next dispatch.

## Sending non-JSON bodies

`post`/`put`/`patch` JSON-stringify the body unless it's already a string, `FormData`, `URLSearchParams`, or `Blob`:

```ts
// JSON (default)
api.post("/users", { name: "Alice" });

// Form data
const form = new FormData();
form.append("file", file);
api.post("/upload", form);

// URL-encoded
api.post("/login", new URLSearchParams({ user: "alice", pass: "secret" }));

// Raw text
api.post("/webhook", "raw payload", { headers: { "Content-Type": "text/plain" } });
```

The client sets `Content-Type: application/json` automatically for objects, and leaves the header alone for `FormData` (so the browser can set the multipart boundary).

## Next

- [DI container](./07-di-container.md) — registering API clients, scoped instances per request
- [Observability](./08-observability.md) — logging request failures, capturing them in monitoring
