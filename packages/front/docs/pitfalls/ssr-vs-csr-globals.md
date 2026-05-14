# Pitfall: SSR vs CSR globals

## Symptom

The build succeeds. The dev server starts. The first request to any SSR route crashes with:

```
ReferenceError: window is not defined
    at /src/lib/foo.ts:3:13
```

Or, more subtly:

```
TypeError: Cannot read properties of undefined (reading 'getItem')
    at /src/lib/storage.ts:5:34
```

The browser-only global (`window`, `document`, `localStorage`, `navigator`, `matchMedia`, `IntersectionObserver`, ...) doesn't exist on Node — Node has none of them.

## Root cause

You're reading a browser-only global at **module evaluation time** in a file imported by your SSR entry. The module graph dragged it in even though you only use it on the client.

Common entry points:

- A `controllers/foo.ts` that imports a `lib/analytics.ts` with `window.gtag` at module top
- A `lib/storage.ts` factory that calls `localStorage.getItem` at import time
- An animation library auto-running `requestAnimationFrame` on import

The same problem in reverse hits the browser:

- Server-only code (`process.env.X`, Node `fs`, `path`) imported by something the browser bundle pulled in
- Vite tree-shakes most, but not all, and dynamic imports can defeat tree-shaking

## Diagnosis

When the SSR entry crashes, the error message includes the file. Read top-to-bottom — the first `import` chain that touches a browser global is the offender.

To find browser-only code preemptively, grep:

```bash
rg -n '\b(window|document|localStorage|sessionStorage|navigator|matchMedia|location)\b' src/
```

Cross-reference with what's imported transitively from `src/ssr.ts`. Anything reachable from `ssr.ts` must be SSR-safe.

## Fix

### Guard with an environment check

```ts
// GOOD — safe on both sides
function getStoredTheme(): "light" | "dark" {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem("theme") as "light" | "dark") ?? "light";
}
```

`typeof window === "undefined"` is the canonical SSR check. It's safer than `typeof process !== "undefined"` because some bundlers polyfill `process` on the client.

### Move to lifecycle hooks

```ts
// BAD — runs at import time
const analytics = createAnalytics(window.location.host);
export function track(event: string) {
    analytics.send(event);
}
```

```ts
// GOOD — runs after framework start in the browser
let analytics: Analytics | null = null;

export function track(event: string) {
    if (!analytics) {
        if (typeof window === "undefined") return;
        analytics = createAnalytics(window.location.host);
    }
    analytics.send(event);
}
```

Or use `startBrowserApp`'s `onBeforeStart`:

```ts
startBrowserApp({
    bootstrap,
    onBeforeStart(framework) {
        const analytics = createAnalytics(window.location.host);
        framework.container.register("analytics", () => analytics);
    },
    mount: /* ... */,
});
```

Then resolve from DI in controllers/views — never touch `window` directly in shared code.

### Conditional import

For libraries that crash on import in Node (animation libs, audio libs), import dynamically only on the browser:

```ts
let confetti: ((options?: any) => void) | null = null;

if (typeof window !== "undefined") {
    import("canvas-confetti").then((m) => {
        confetti = m.default;
    });
}

export function celebrate() {
    confetti?.();
}
```

Or register the import in `onBeforeStart`:

```ts
onBeforeStart: async (framework) => {
    const { default: confetti } = await import("canvas-confetti");
    framework.container.register("confetti", () => confetti);
},
```

### Use the framework's abstractions

The framework provides DI keys that work on both sides:

- `DEP_KEYS.PLATFORM` — the parsed user-agent on the server, navigator-derived on the client
- `DEP_KEYS.STORAGE` — `localStorage` on the client, in-memory map on the server
- `DEP_KEYS.LOCALE` — resolved locale on both sides

Use these instead of reading globals directly. They're cross-platform by design.

## Symptom: works locally, fails in production build

Sometimes the dev server tolerates a global access (via Vite's lazy evaluation) but the production build crashes. The cause is usually a module that's tree-shaken in dev but not in prod, or vice versa.

Test the production build before deploying:

```bash
pnpm build
pnpm preview
# hit the SSR routes
```

The `vp preview` server runs the same code path as production — if it doesn't crash, the deploy won't either (at least not from this class of bug).

## Symptom: works in production but blank page in dev

Inverse problem — server-only code leaked into the client bundle, and the browser crashed during hydration before the view layer mounted.

Open browser devtools, check the console for `process is not defined` / `require is not defined`. The fix is the same: guard with `typeof window === "undefined"` (inverted: guard with `typeof window !== "undefined"`) or move to a lifecycle hook.

## Why imports matter, not "code that runs"

You may be tempted to "just not call the function" instead of guarding the import:

```ts
// import-time check
if (typeof window !== "undefined") {
    // never actually called on SSR
    setupAnalytics();
}
```

But the `import` itself runs the module's top-level code. If `lib/analytics.ts` calls `window.gtag` at module top-level (e.g., as part of `const analytics = window.gtag.bind(window)`), the crash happens **at import**, before your `if` check.

Fix the imported module to be import-safe, not just call-safe.

## Related

- [Pitfall: SSR hydration mismatch](./ssr-hydration-mismatch.md) — when SSR runs but produces different output than CSR
- [DI container](../07-di-container.md) — registering cross-platform services
