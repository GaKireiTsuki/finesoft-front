# Pitfall: SSR hydration mismatch

## Symptom

After SSR, the browser console logs a hydration warning:

```
[Vue warn]: Hydration node mismatch — server rendered "<div>Loading...</div>" but client expected "<div>Welcome, Alice</div>"
```

The page flickers between the SSR-rendered content and the client-rendered content. State that should be already loaded triggers a refetch.

## Root cause (most common)

The server and the browser produced **different `Page` objects** for the same URL because something they read disagreed between sides:

- Random / time-based values (`Math.random()`, `Date.now()`)
- Reading `window` / `localStorage` / `document.cookie` on the server (these are `undefined`)
- Reading `process.env` on the browser (these are `undefined` after bundling)
- User-Agent-dependent rendering when SSR didn't see the real UA
- Async race: the controller's `execute()` returned different data on each call

The hydration cache (`PrefetchedIntents`) lookup missed, so the browser re-ran the controller — and got a different result.

## Root cause (less common)

The `PrefetchedIntents` key (intentId + stable-stringified params) doesn't match between server and browser:

- Params object has values that don't stringify deterministically (Maps, Sets, class instances, Symbols)
- Controller mutates `params` in place — the dispatch key was computed from the original, but the controller saw the mutated version

## Diagnosis

```ts
// In your view, log the page on both sides:
console.log("[hydration]", typeof window === "undefined" ? "SSR" : "CSR", page);
```

Compare the two logs. The first different field is the root cause.

For `PrefetchedIntents` debugging, log the cache state in the browser:

```ts
startBrowserApp({
    bootstrap,
    onBeforeStart(framework) {
        console.log("[prefetched]", framework.prefetchedIntents.dump());
    },
    mount: /* ... */,
});
```

If the dump shows the intent **with different params** than what the browser's first navigation tries to dispatch, you've got a key mismatch.

## Fix

### Stop reading platform-only globals at module level

```ts
// BAD
const userId = localStorage.getItem("uid"); // throws on SSR
const isDarkMode = matchMedia("(prefers-color-scheme: dark)").matches; // throws on SSR
const csrfToken = document.querySelector("meta[name=csrf]")?.content; // null on SSR

export class HomeController extends BaseController {
    /* uses userId */
}
```

```ts
// GOOD
export class HomeController extends BaseController {
    async execute(_params, container) {
        // resolve from DI; the request scope has the right value on each side
        const session = container.resolve<Session>("session");
        return { kind: "home", userId: session.userId };
    }
}
```

Cookies are accessible on both sides via `container.resolve("session")` (after you register it). `localStorage` is browser-only — if the SSR side needs the same value, surface it via a cookie or query param.

### Don't use randomness / time-based logic in `execute()`

```ts
// BAD — server and browser compute different values
async execute() {
    return { kind: "home", randomGreeting: pick(greetings) };
}
```

If you need randomness, compute it once on the server and let the client reuse it via `PrefetchedIntents` (it does, automatically). Don't try to "re-randomize on the client" — that's exactly what causes mismatch.

For time-based logic, decide on the server and ship the result:

```ts
async execute() {
    const isOfficeHours = new Date().getHours() >= 9 && new Date().getHours() < 17;
    return { kind: "home", isOfficeHours };
}
```

Both sides will see `isOfficeHours: true` because the browser reads from cache, not re-evaluates.

### Make `params` JSON-clean

```ts
// BAD — dispatchAction with non-serializable params
framework.dispatch({
    intentId: "search",
    params: {
        query: "widget",
        filters: new Set(["red", "small"]), // Sets don't JSON.stringify well
        startDate: new Date(), // becomes ISO string, OK, but...
        validator: new Validator(), // class instance — won't survive
    },
});
```

```ts
// GOOD — primitives + plain objects only
framework.dispatch({
    intentId: "search",
    params: {
        query: "widget",
        filters: ["red", "small"],
        startDate: "2026-05-14",
    },
});
```

The `PrefetchedIntents` cache uses **stable stringification** — same keys in different order produce the same key, and circular references are detected. But non-JSON values are coerced to strings or dropped silently.

### Don't mutate `params`

```ts
// BAD
async execute(params, container) {
    params.userId = container.resolve("session").userId;   // mutation
    return loadFor(params);
}
```

```ts
// GOOD
async execute(params, container) {
    const effective = { ...params, userId: container.resolve("session").userId };
    return loadFor(effective);
}
```

The dispatcher computed the cache key from the original `params`. If you mutate it, the next dispatch with the original shape misses the cache.

## Why `stableStringify` matters

The framework's `stableStringify` (in `packages/core/src/prefetched-intents/stable-stringify.ts`) handles object key ordering. It uses a `seen` Set with `try/finally` cleanup to support DAGs (same object referenced multiple times) — without the cleanup, a DAG would be reported as a false circular reference and the key would silently differ between server and browser.

If you see "Circular reference detected" warnings during SSR but the data is genuinely a DAG, file a bug — the cleanup is supposed to handle this.

## Related

- [Pitfall: SSR vs CSR globals](./ssr-vs-csr-globals.md) — where the platform-only globals live
- [Chapter 4: Rendering & hydration](../04-rendering-and-hydration.md) — how `PrefetchedIntents` works
