# 12. Session restoration

The framework already restores the **first screen**: SSR injects the prefetched intent results through `PrefetchedIntents`, and the browser reuses them on the first navigation. Structured navigation also carries the current tree across back/forward via `history.state`.

But one class of state survives **none** of that: what the user was actually _doing_ when they **hard-reloaded, crashed the tab, or closed and came back** — which screen (or stack depth, or tab, or split column) they were on, the half-typed draft in a form, how far a list was scrolled. The in-memory `history.state` map is wiped by a full reload; `PrefetchedIntents` only covers the one server-rendered screen.

**Session restoration** fills that gap: it serializes a versioned, JSON-safe **session snapshot** (navigation position + app-registered state slices + navigation-scoped per-screen state) to a pluggable `Storage`, and rehydrates it on a fresh load. The framework ships **no UI** — it restores **state**, and your app re-renders from it however you like.

It is entirely opt-in: an app that never passes `session` to `startBrowserApp` is **byte-for-byte unchanged**.

## The two scopes

A snapshot captures two layers of state, serialized together and restored together across a reload:

| Scope                       | Lives in | Keyed by       | Lifetime                                                                | SwiftUI analogue |
| --------------------------- | -------- | -------------- | ----------------------------------------------------------------------- | ---------------- |
| **Global slices**           | `slices` | `provider.key` | The whole session (theme, a cross-screen wizard draft…)                 | `@SceneStorage`  |
| **Navigation-scoped state** | `scoped` | `entryKey`     | Bound to one navigation entry — dropped when that entry leaves the tree | `@State`         |

- **Global slices** are app-wide. You register a `SessionStateProvider` per slice; the framework orchestrates _when_ it is captured and persisted. It never interprets the contents — it only moves them.
- **Navigation-scoped state** is bound to a _navigation entry_, mirroring the position-scoped lifecycle of a SwiftUI view's `@State` (covered below).

## Global slices: `SessionStateProvider`

An app registers one provider per slice. `capture()` returns a JSON-safe synchronous value; `restore(data)` puts it back (your app calls `setState` / refills the form / scrolls):

```ts
import type { SessionStateProvider } from "@finesoft/front";

const themeSlice: SessionStateProvider<string> = {
    key: "theme",
    capture: () => getCurrentTheme(),
    restore: (theme) => applyTheme(theme),
};
```

The framework moves the value verbatim and never inspects it — so **you** decide what to capture. Exclude sensitive fields right here in `capture()`; a slice you never register is never captured.

## Navigation-scoped state: the SwiftUI `@State` lifecycle

Navigation-scoped state is the interesting half. It is keyed by **entry identity**, not by visibility, and it follows the same position-scoped lifecycle as a SwiftUI view's `@State`:

> `A` → push `B` → go back (pop `B`) to `A`: **`B`'s state is discarded, `A`'s state is still there.**

The mechanism: each entry's state bag is stored under `entryKey = intent + " " + stableStringify(params)` — the same identity the navigation controller uses for a destination, so it is **stable across a reload**. After every committed navigation, the framework **prunes** the scoped map down to the entries **actually present in the tree** — note _present_, not _visible_. Any key whose entry is no longer in the tree is dropped.

```ts
import { sessionEntryKey } from "@finesoft/front";

// When you render a screen, read/write its scoped bag with the entry's key:
const key = sessionEntryKey("post", { id: 7 });
store.scope.set(key, { scroll: 240, draft: "half a comment" });
const bag = store.scope.get(key); // -> { scroll: 240, draft: "..." } | undefined
```

Walking through the lifecycle:

- **push `B`** → tree `[A, B]`, present `{A, B}` → `A`'s state is **kept** (`A` is still on the stack, just not visible) and `B` gets its own scope.
- **pop `B`** → tree `[A]`, present `{A}` → **`B`'s scope is pruned away**, `A`'s is kept intact; going back to `A` renders with its retained state.
- **switch a TabView tab** → the other branches are still in the tree → their state is kept alive (exactly like SwiftUI keeping inactive tabs mounted).
- **across a reload** → `scoped` is serialized into the snapshot; after reload, every entry still in the tree gets its scope back, and a later pop discards it as usual.

`store.scope` is the `NavigationScopedState` instance held by the store — `get` / `set` / `delete` / `keys`, plus the `prune(presentKeys)` the framework calls for you.

### Flat vs structured: retention _is_ a stack

That "keep `A` under `B`, drop `B` on pop, restore `A`" behavior is, by definition, **stack semantics** — so it only exists in **structured navigation**, where a stack/tree can hold entries that are _present but not visible_.

A **flat single page has no stack**: `A → B` is a full-page replacement, so `presentKeys()` is always a single entry (the current URL). The moment you leave a screen its scope is pruned, and a browser **Back** re-renders it fresh.

Both modes support "current-screen scope + restore-across-reload". If you want "go Back and keep the previous screen", build it as a structured stack — push instead of replace. That is precisely what `NavigationStack` is _for_; it is not a shortcoming of flat mode.

## The snapshot

`createSessionStore(options)` returns the `SessionStore` orchestrator. `capture()` assembles a snapshot without persisting; the snapshot model is:

```ts
interface SessionSnapshot {
    readonly version: number;
    readonly navigation?: SerializedNavigation | SessionUrlLocation; // structured tree | { url }
    readonly slices: Readonly<Record<string, unknown>>; // provider.key -> capture()
    readonly scoped: Readonly<Record<string, unknown>>; // entryKey -> state bag
    readonly capturedAt: number; // epoch ms, for maxAgeMs expiry
}
```

`navigation` is discriminated with a light guard: a `SerializedNavigation` always carries a `kind` (leaf/stack/tabs/split); a flat `SessionUrlLocation` carries a `url`. `isUrlLocation(nav)` tells them apart.

The store exposes:

```ts
interface SessionStore {
    register(provider: SessionStateProvider): () => void; // returns a disposer
    readonly scope: NavigationScopedState;
    capture(): SessionSnapshot; // assemble (nav + slices + scoped), no I/O
    persist(snapshot?: SessionSnapshot): void; // capture() if omitted, then write
    load(): SessionSnapshot | undefined; // read + validate (version / maxAge / shape)
    restore(snapshot?: SessionSnapshot): void | Promise<void>; // load() if omitted, then apply
    clear(): void; // remove the persisted snapshot
    save(): void; // capture + persist — the manual escape hatch
}
```

`load()` discards a snapshot whose version mismatches, whose `capturedAt` is older than `maxAgeMs`, or whose shape is malformed — it returns `undefined` rather than ever throwing into your app. A provider that throws in `capture()` / `restore()` is isolated: its slice is skipped, the error goes to `onError`, and the rest of the snapshot survives.

## Persistence: `sessionStorage` by default, swappable

The snapshot is encoded with a stable stringify and written as a single `storage.set(key, ...)`. `Storage` is the existing core dependency interface, so durability is **your** choice:

```ts
import { createWebStorage } from "@finesoft/front";

createWebStorage("session"); // sessionStorage — tab-scoped, cleared when the tab closes (default)
createWebStorage("local"); // localStorage — survives across tabs and restarts
```

`createWebStorage` maps `get`/`set`/`delete` onto `getItem`/`setItem`/`removeItem`, swallows quota errors on write (session restoration is best-effort — it never interrupts navigation), and degrades to a safe no-op when the chosen Web Storage is unavailable (e.g. private mode `SecurityError`).

Because it is just the `Storage` interface, you can supply **any** implementation — an in-memory store for tests, or a server-synced `Storage` for cross-device restoration. The framework v1 ships no built-in server endpoint, but the seam is open.

## Wiring it into the browser

Pass an optional `session` to `startBrowserApp`. When present, the framework builds a `SessionStore`, registers your providers, wires a `SessionBridge` (auto-capture on navigation + `pagehide`/`visibilitychange`), runs the boot restore after the first navigation, and hands you a `SessionHandle`:

```ts
// src/main.ts
import { startBrowserApp, type SessionHandle } from "@finesoft/front";
import { bootstrap } from "./bootstrap";
import { mount } from "./lib/mount";
import { themeSlice, draftSlice } from "./lib/session";

let session: SessionHandle;

startBrowserApp({
    bootstrap,
    mount,
    callbacks,
    session: {
        providers: [themeSlice, draftSlice],
        // storage defaults to createWebStorage("session")
        maxAgeMs: 1000 * 60 * 60 * 24, // discard snapshots older than a day (optional)
    },
    onSessionReady(handle) {
        session = handle;
    },
});
```

When `session` is **absent**, none of this runs and the original `startBrowserApp` path is byte-for-byte unchanged.

### Flat vs structured wiring (automatic)

`startBrowserApp` picks the navigation adapter for you:

- **With** a `navigation` config → the structured `createNavigationSessionAdapter(controller)`: it serializes the whole tree, and on restore `hydrate`s it back. Auto-capture is driven by the navigation handle's `subscribe`.
- **Without** `navigation` (flat single page) → the `createUrlSessionAdapter` bound to `framework.perform(makeFlowAction(url))`: it captures `{ url }` and navigates on restore.

You only choose the adapter directly if you are assembling the store yourself (e.g. on the server, or in tests).

## The handle: manual save / clear / dispose

`onSessionReady` gives you a `SessionHandle` for the escape hatches — auto-capture already runs, but you can force a write, clear the snapshot, or tear everything down:

```ts
interface SessionHandle {
    restore(currentUrl: string): void | Promise<void>; // boot restore (already called for you)
    save(): void; // force an immediate persist
    clear(): void; // drop the persisted snapshot (e.g. on logout)
    dispose(): void; // unsubscribe navigation + remove pagehide/visibilitychange + clear timers
}
```

Call `handle.clear()` on logout so the next user doesn't inherit a stale session; call `handle.dispose()` if you tear down the app instance yourself.

### When does it capture?

You rarely call `save()` — capture is automatic:

- **On navigation change**: the bridge first prunes the scoped map to `adapter.presentKeys()` (this is where "pop `B` drops `B`'s state" actually lands), then **debounces** a write (default `SESSION_DEFAULT_DEBOUNCE_MS` = 500 ms, coalescing rapid navigations). Tune with `session.debounceMs`.
- **On `pagehide` and `visibilitychange` (hidden)**: it persists **immediately** and cancels any pending debounce — more reliable than `beforeunload` on mobile (the last state is captured before the tab is backgrounded or reclaimed).

## Deep-link policy: `shouldRestore`

On boot the bridge reads the snapshot and applies it **only if** `shouldRestore(snapshot, currentUrl)` passes — a single boolean gate for the whole `nav + slices` restore. The default, `defaultShouldRestore`, honors **explicit deep links over a stale session**:

| Snapshot `navigation`                   | Restores when…                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| **Flat** (`SessionUrlLocation`)         | `currentUrl === snapshot.navigation.url` **or** the current path is root `/` |
| **Structured** (`SerializedNavigation`) | the current path is root `/`                                                 |
| **None** (slices only)                  | always (URL-independent)                                                     |

So reloading the same page (or entering fresh at `/`) restores; opening a different deep link `/x` does **not** get overwritten by an old session. "Root" is the path `=== "/"` (query/hash stripped). Apps served under a base path should override the gate:

```ts
session: {
    providers: [themeSlice],
    shouldRestore: (snapshot, currentUrl) => currentUrl.startsWith("/app/"),
}
```

Restoring to a different state than the SSR'd URL produces one client-side jump (SSR renders the URL's screen, then the client restores). That timing is exposed through the bridge so you can control it; a pure-CSR app can restore before first paint and avoid it entirely.

## What is _not_ captured

- **DOM you didn't register.** The framework never scans the DOM. State slices are whatever your providers `capture()` — nothing more.
- **Anything when you register no providers.** With only navigation (or nothing) registered, capture is effectively zero — the privacy default.
- **Sensitive fields you exclude.** `capture()` is your filter; strip tokens, PII, and the like there.
- **A stale, expired, or malformed snapshot.** `load()` returns `undefined` instead of crashing the app to restore a bad state.

## Backward compatibility

- An app that doesn't pass `session` to `startBrowserApp` runs the **original path** with zero behavior change — the entire feature is gated behind that one field.
- Session restoration adds no requirement on the server. A server-synced snapshot is possible by supplying your own `Storage`, but nothing is built in.
- The framework restores **state**, never UI. Your `Page` models and how you render them are untouched.

## Next

- [Navigation](./11-navigation.md) — the structured tree whose entries scope per-screen state
- [Rendering & hydration](./04-rendering-and-hydration.md) — how the first screen is already restored via prefetched results
- [DI container](./07-di-container.md) — the `Storage` dependency that session restoration persists through
