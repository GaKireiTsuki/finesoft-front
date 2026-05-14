# 3. Middleware

Middleware runs in two phases around the controller. A guard inspects the navigation, then returns one of four results to control what happens next.

## Pipeline

```
Router.resolve()
     │
     ▼
  beforeLoad chain        ← NavigationContext (no page yet)
     │
   next()? ──no──▶ short-circuit (redirect / rewrite / deny)
     │ yes
     ▼
IntentDispatcher.dispatch()
     │
     ▼
  afterLoad chain         ← PostLoadContext (page exists)
     │
   next()? ──no──▶ short-circuit
     │ yes
     ▼
   render
```

Guards run in array order. The first non-`next()` result short-circuits the rest of the chain.

## The four results

```ts
import { next, redirect, rewrite, deny } from "@finesoft/front";

next(); // continue to the next guard / dispatcher
redirect("/login"); // HTTP 302; navigate to URL
redirect("/old", 301); // HTTP 301 (permanent)
rewrite("/canonical"); // internal re-route in beforeLoad; canonicalization signal in afterLoad
deny(); // 403 Forbidden
deny(404, "Not found"); // custom status + message
```

### `next()`

Pass-through. The pipeline continues.

### `redirect(url, status?)`

The browser navigates to `url` and the original render is abandoned. On the server this becomes an HTTP redirect; on the browser it becomes a navigation (via `History.pushState`).

Use for: login redirects, deprecated paths, locale-prefix canonicalization.

### `rewrite(url)`

**`beforeLoad` rewrite** — internal re-route. The router resolves `url` instead, and the _new_ match's guards + controller run. No HTTP redirect is emitted; the original URL stays in the address bar. Bounded depth (5 levels) to prevent loops.

**`afterLoad` rewrite** — canonicalization signal. The framework includes the rewrite URL in the SSR response as a `Content-Location` header without redirecting. Browsers receive the original URL with a hint that a canonical version exists.

See [redirect vs rewrite](./pitfalls/redirect-vs-rewrite.md) for when to use which.

### `deny(status?, message?)`

Stops the request. Default `403 Forbidden`. Common: `deny(401, "Login required")`, `deny(404, "Not found")`.

## Writing guards

A guard is a function from context to a `MiddlewareResult` (or `Promise<MiddlewareResult>`).

```ts
// src/lib/guards/auth.ts
import { next, redirect, type NavigationContext } from "@finesoft/front";

export function authGuard(ctx: NavigationContext) {
    const token = ctx.getCookie("token");
    if (!token) {
        return redirect(`/login?next=${encodeURIComponent(ctx.url.pathname)}`);
    }
    return next();
}
```

### `NavigationContext` (beforeLoad)

| Field             | Type                               | Notes                                                |
| ----------------- | ---------------------------------- | ---------------------------------------------------- |
| `url`             | `URL`                              | Full request URL.                                    |
| `intent`          | `Intent`                           | Resolved intent with parsed path params.             |
| `container`       | `Container`                        | Request-scoped DI container.                         |
| `getCookie(name)` | `(name: string) => string \| null` | Read a cookie (server + browser).                    |
| `getHeader(name)` | `(name: string) => string \| null` | Read a request header (server only; browser → null). |
| `isSsr`           | `boolean`                          | `true` on server, `false` in browser.                |

### `PostLoadContext` (afterLoad)

Extends `NavigationContext` with:

| Field  | Type       | Notes                                |
| ------ | ---------- | ------------------------------------ |
| `page` | `BasePage` | The page produced by the controller. |

## Attaching guards to routes

```ts
defineRoutes(framework, [
    {
        path: "/admin",
        intentId: "admin",
        controller: new AdminController(),
        beforeLoad: [authGuard, requireAdminRole],
        afterLoad: [trackPageView],
    },
]);
```

Guards on a route run **in addition** to any global guards registered on the framework (see below). Order: globals first, then route-specific.

## Global guards

Register guards that apply to every navigation:

```ts
framework.middleware.use("beforeLoad", trackingGuard);
framework.middleware.use("afterLoad", metricsGuard);
```

Use sparingly. Global guards run on every page, including SSR — slow global guards multiply across the entire surface area.

## Common patterns

### Authentication

```ts
function authGuard(ctx: NavigationContext) {
    const token = ctx.getCookie("session");
    if (!token) return redirect("/login?next=" + encodeURIComponent(ctx.url.pathname));
    return next();
}
```

### Role check

```ts
async function requireAdmin(ctx: NavigationContext) {
    const session = await ctx.container.resolve<SessionService>("session").current();
    if (!session?.isAdmin) return deny(403, "Admin only");
    return next();
}
```

### Locale prefix redirect

```ts
function localePrefixGuard(ctx: NavigationContext) {
    if (/^\/(en|zh|ja)\//.test(ctx.url.pathname)) return next();
    const detected = detectLocale(ctx); // your own logic
    return redirect(`/${detected}${ctx.url.pathname}`, 301);
}
```

### A/B test rewrite

```ts
function abTestGuard(ctx: NavigationContext) {
    if (ctx.url.pathname !== "/landing") return next();
    const variant = bucket(ctx.getCookie("uid"));
    return variant === "B" ? rewrite("/landing-v2") : next();
}
```

The user sees `/landing` in the address bar; the server renders `/landing-v2`. No client-visible redirect, no flicker.

### After-load analytics

```ts
function trackPageView(ctx: PostLoadContext) {
    ctx.container.resolve<EventRecorder>("eventRecorder").record({
        name: "PageView",
        fields: { intentId: ctx.intent.intentId, url: ctx.url.pathname },
    });
    return next();
}
```

## Guard ordering rules

1. Global `beforeLoad` guards (registration order)
2. Route-specific `beforeLoad` guards (array order)
3. Controller `execute()`
4. Global `afterLoad` guards
5. Route-specific `afterLoad` guards

A non-`next()` result at any step stops the rest. Subsequent guards do not run.

## Async guards

Guards can be `async`. The pipeline awaits each result before moving on. Avoid long awaits in global guards (they multiply across every request).

```ts
async function rateLimitGuard(ctx: NavigationContext) {
    const limiter = ctx.container.resolve<RateLimiter>("rateLimiter");
    const allowed = await limiter.tryConsume(ctx.getCookie("uid") ?? "anon");
    return allowed ? next() : deny(429, "Too many requests");
}
```

## Caveats

- **Guards must be pure with respect to the framework state.** Don't mutate `ctx.intent.params` — make a new intent and `rewrite` if you need to change params.
- **`deny()` in `afterLoad` discards the produced page.** The controller already ran; deny only blocks the response. If `execute()` had side effects (writes), they already happened.
- **Browser-side guards do not have access to request headers.** `getHeader()` returns `null` on the client. Cookies still work.

## Next

- [Rendering & hydration](./04-rendering-and-hydration.md) — what happens between `afterLoad` and HTML output
- [Pitfalls: redirect vs rewrite](./pitfalls/redirect-vs-rewrite.md) — choosing between the two
