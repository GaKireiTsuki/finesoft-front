---
"@finesoft/front": minor
---

Secure-by-default SSRF defense and prefetch allowlist; new safeErrorPage and request-scoped DI helpers.

This release adds the defaults a CTF-style adversarial drill (see `adversarial/`) showed the framework was missing. Driven by what attackers actually walked through.

### `HttpClient` now refuses internal hosts by default (potentially breaking)

`HttpClient` and the new `DEP_KEYS.SAFE_FETCH` reject loopback / RFC1918 / RFC4193 / IPv4-mapped IPv6 / decimal+hex+octal IPv4 / multicast / reserved-range targets before any request is sent. Hostnames are DNS-resolved (Node only) and each resolved IP is checked, so `localtest.me`-style rebinding is blocked too.

**Opt-out** for legitimate internal calls:

```ts
new HttpClient({ baseUrl: "http://127.0.0.1:9999", allowInternalHosts: true });
container.resolve(DEP_KEYS.FETCH); // the raw, unguarded fetch is still available
```

Catch `HostGuardError` to give a business-friendly error.

### `markPublic(page, fields)` declares which page fields the client may see

Add a Symbol-based marker to your `BasePage` return value so `serializeServerData` only emits whitelisted fields into the SSR HTML. Unmarked pages keep the old all-fields behaviour for back-compat, with a one-time dev warning. A future major will default to BasePage-only fields.

```ts
import { markPublic } from "@finesoft/front";

return markPublic(
    { ...user, apiToken: user.apiToken }, // apiToken stays server-side
    ["id", "pageType", "title", "email"], // only these enter the HTML
);
```

`serializeServerData` also accepts `{ onUnmarkedPage: "base-fields" | "strict" }` for stricter pipelines.

### `safeErrorPage({ status, publicMessage, devError })` for error pages

Returns a `BasePage` whose `description` is the safe message in production and only includes `devError` (stack/path/etc.) when `NODE_ENV !== "production"`. Use it in `getErrorPage`, in `BaseController.fallback`, anywhere you currently splat `error.stack` into a page.

### `defineRequestScopedKey<T>(key)` typed handle for per-request DI state

Makes the "request-scoped" path the obvious path so middleware authors stop reaching for `let lastUser` at module scope:

```ts
export const CURRENT_USER = defineRequestScopedKey<TracedUser | null>("app.user");

// middleware
export const traceUser: BeforeLoadGuard = (ctx) => {
    CURRENT_USER.set(ctx, parseUser(ctx));
    return next();
};

// controller
const user = CURRENT_USER.get(container);
```

### Smaller additions

- `Container.unregister(key)` — explicit removal instead of `register(() => null)`
- `classifyHost` / `classifyUrl` exported for callers that want host-guard semantics without `HttpClient`
- `secureFetch(baseFetch, opts)` exported as a free function
- Vite dev plugin now prints a one-line safety banner noting that `/src/*` and `/@fs/*` expose source — run `vp build && vp preview` for production.
