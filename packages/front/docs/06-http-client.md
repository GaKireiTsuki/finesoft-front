# HTTP client

`HttpClient` is an optional typed fetch wrapper. Its `fetch` dependency is explicit. Server connection-address validation is host-provided; browser applications must explicitly choose their browser DNS policy.

```ts
import { HttpClient, type HttpClientConfig } from "@finesoft/front";
interface User {
    id: string;
    name: string;
}
export class UserApi extends HttpClient {
    constructor(config: HttpClientConfig) {
        super(config);
    }
    getById(id: string, signal?: AbortSignal) {
        return this.get<User>(`/users/${encodeURIComponent(id)}`, undefined, { signal });
    }
    create(user: Omit<User, "id">) {
        return this.post<User>("/users", user);
    }
    remove(id: string) {
        return this.del<void>(`/users/${encodeURIComponent(id)}`);
    }
}
```

## Host binding

```ts
// Node host code; keep this import out of browser and Worker modules.
import { nodeSafeFetchOptions } from "@finesoft/front";
const api = new UserApi({ baseUrl: "https://api.example.com", fetch, ...nodeSafeFetchOptions });
```

Browser code may construct the same class with an absolute API URL, its chosen fetch implementation and `validateDns: false`. That explicitly gives DNS resolution to the browser. Do not silently disable a required server capability. Internal/loopback targets are blocked by default; host configuration must deliberately opt in where required.

The Node entry includes its connection transport as a lazy chunk; consumers need no extra transport package. Standard Node/Vercel/Netlify, development and preview hosts use `nodeSafeFetchOptions`: all DNS answers are checked inside connection creation, and those exact addresses reach the socket while hostname, TLS SNI, cancellation and pooling remain intact. The pool loads lazily and stays outside browser/Worker graphs. Custom Node fetch implementations must honor Undici's `dispatcher` option. `nodeDnsLookup` alone is only a preflight and does not prevent a DNS change before connection.

Protected fetch checks each redirect, follows at most 20 hops and removes authentication/cookie headers across origins. Explicit `manual` / `error` modes retain their meaning. Opaque browser redirects are rejected because their destination is unreadable. Redirects requiring replay of `Request.body` or a streamed body are rejected without unbounded tee buffering; use a replayable `RequestInit.body` (such as a string) or the final URL. `allowInternalHosts: true` explicitly opts out of these protections.

For scoped business services, declare a typed provider and acquire it with `context.get(token)`; see [Dependencies](./07-di-container.md). Bind the invocation's fetch and signal so request cancellation propagates. A cancelled command may already have performed a write; cancellation is not rollback. The operation runtime does not implicitly retry or cache commands.

Request and response interceptors run in registration order. `HttpError` represents non-success HTTP results. The generic result type describes expected data; validate untrusted response payloads at the business boundary when necessary. The lower-level protected methods are `get`, `post`, `put`, `del` and `request`; `get`/`del` accept query parameters before request options.
