# Pitfall: redirect vs rewrite

## Symptom A — wrong URL in the address bar

A guard runs `rewrite("/canonical")`, but the user sees `/canonical` in the address bar. You wanted the original URL preserved.

## Symptom B — extra round-trip

A guard runs `redirect("/login")`, the browser shows a flicker / network panel shows a 302 → 200 round-trip. You wanted in-process re-routing.

## Symptom C — `afterLoad` rewrite seemed to issue a 301

A guard in `afterLoad` returns `rewrite("/clean-url")`. The browser hits the rewrite URL, gets the canonical content, and your server logs show two requests. You expected one.

## Root cause

`redirect` and `rewrite` look similar but mean fundamentally different things, and `rewrite` itself behaves differently in `beforeLoad` vs `afterLoad`.

| Result                            | What happens                                                             | Visible to user as                           | Use for                                           |
| --------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------- |
| `redirect("/foo", 302)`           | HTTP 302 with `Location: /foo` (server) or `pushState("/foo")` (browser) | Address bar changes to `/foo`                | Auth gates, locale redirects, deprecated paths    |
| `redirect("/foo", 301)`           | Same but cacheable as permanent                                          | Address bar changes; cached                  | Permanent canonicalization                        |
| `rewrite("/foo")` in `beforeLoad` | Router resolves `/foo` instead; new match's guards + controller run      | Address bar stays original                   | A/B tests, feature-flag routing, internal aliases |
| `rewrite("/foo")` in `afterLoad`  | `Content-Location: /foo` header; controller already ran                  | Address bar stays original; no extra request | Canonical-URL signal to crawlers; analytics dedup |

## The semantic difference

**Redirect** = "the user should be at a different URL." The address bar is the source of truth, and the framework tells the browser to update it.

**Rewrite in `beforeLoad`** = "this URL maps to another internally." The user's URL stays; the framework picks a different controller to satisfy the request. Like Nginx's `rewrite ... last;`.

**Rewrite in `afterLoad`** = "this content is also available at a canonical URL." The page already rendered (the controller already ran); the response just includes a hint via `Content-Location`. The browser does **not** follow it as a redirect — it's metadata.

## Fix Symptom A — you used `redirect` when you wanted `rewrite`

```ts
// BAD — user sees /landing-v2 in address bar
function abTestGuard(ctx: NavigationContext) {
    if (ctx.url.pathname !== "/landing") return next();
    return bucket(ctx) === "B" ? redirect("/landing-v2") : next();
}
```

```ts
// GOOD — user keeps /landing, server renders /landing-v2 internally
function abTestGuard(ctx: NavigationContext) {
    if (ctx.url.pathname !== "/landing") return next();
    return bucket(ctx) === "B" ? rewrite("/landing-v2") : next();
}
```

Same applies to mobile routing, feature flags, locale-based content swapping — anything where the user shouldn't notice the underlying URL changed.

## Fix Symptom B — you used `rewrite` when you wanted `redirect`

```ts
// BAD — user remains on the protected URL; the wrong controller runs
function authGuard(ctx: NavigationContext) {
    if (!ctx.getCookie("token")) return rewrite("/login");
    return next();
}
```

If `rewrite` is used here:

- The address bar stays at `/admin` (confusing — the user thinks they're already at admin)
- A reload re-runs the login page logic but doesn't change the URL
- Bookmarking `/admin` from this state bookmarks a broken URL

```ts
// GOOD — actually navigate to /login
function authGuard(ctx: NavigationContext) {
    if (!ctx.getCookie("token"))
        return redirect("/login?next=" + encodeURIComponent(ctx.url.pathname));
    return next();
}
```

## Fix Symptom C — `afterLoad` rewrite is canonicalization, not 301

If you actually want a 301 from `afterLoad`, use `redirect`:

```ts
afterLoad: [
    (ctx) => {
        if (ctx.url.search.includes("utm_")) {
            const clean = ctx.url.pathname;
            return redirect(clean, 301);
        }
        return next();
    },
],
```

But note: by the time `afterLoad` runs, **the controller already executed**. If `execute()` had side effects (writes, expensive computation), they happened. Use `beforeLoad` for redirects you want to fire before the work runs.

If you want to ship the rendered page **and** signal "by the way, the canonical URL is /clean":

```ts
afterLoad: [
    (ctx) => {
        if (ctx.url.search.includes("utm_")) {
            return rewrite(ctx.url.pathname);  // no extra request
        }
        return next();
    },
],
```

The response includes `Content-Location: /clean`. Crawlers (Google, Bing) use this for canonical resolution; analytics tools can deduplicate the variants.

## The `rewrite` recursion depth limit

`beforeLoad` rewrites recurse — the new URL's `beforeLoad` chain runs in full, including any rewrites it triggers. The framework caps this at **5 levels** (`MAX_SSR_REWRITE_DEPTH`) to prevent runaway loops.

If you hit:

```
Error: Too many SSR rewrites (max 5): /a → /b → /c → /d → /e → /f
```

You have a guard loop. Common cause: a guard rewrites to a URL whose own guard rewrites back.

```ts
// BAD — /landing rewrites to /v2 which rewrites to /landing
const landingGuard = (ctx) => (ctx.url.pathname === "/landing" ? rewrite("/v2") : next());
const v2Guard = (ctx) =>
    ctx.url.pathname === "/v2" && !ctx.getCookie("v2") ? rewrite("/landing") : next();
```

Fix the loop, not the depth limit.

## Decision tree

```
Need to change what URL the user sees?
├── Yes → redirect (302 for temporary, 301 for permanent)
└── No, URL stays the same
    ├── Need to swap which controller runs?    → rewrite in beforeLoad
    ├── Already rendered; want canonical hint? → rewrite in afterLoad
    └── Need to abort with an error?           → deny(status, message)
```

## Related

- [Chapter 3: Middleware](../03-middleware.md) — the four results explained
- The behavior change was deliberately introduced — see `packages/ssr/src/render.ts` `ssrRenderInternal` and the `rewriteUrl` field
