---
"@finesoft/front": minor
---

Add UI-agnostic session restoration — serialize "what the user was doing" (navigation position + app-global state slices + navigation-scoped per-screen state) to a pluggable `Storage` and rehydrate it on a fresh load (hard-reload / tab crash / close-and-return), for both flat single-page and structured navigation apps. The framework owns the snapshot lifecycle; the app declares what to capture via `SessionStateProvider` and the framework orchestrates timing, persistence, versioning, and error isolation. Absent a `session` config, `startBrowserApp` is byte-for-byte unchanged.

### Snapshot model + two state scopes

`SessionSnapshot` carries three independent fields: `navigation` (structured `SerializedNavigation` or flat `{ url }`), `slices` (app-global key→value pairs, one per `SessionStateProvider`), and `scoped` (navigation-scoped per-entry state bags keyed by `entryKey = intent + " " + stableStringify(params)`). Both `slices` and `scoped` survive across hard reloads. `encodeSnapshot` / `decodeSnapshot` provide a lossless round-trip with graceful handling of malformed JSON, shape mismatches, and version mismatches (all → `undefined`, never throws).

### Navigation-scoped SwiftUI push/pop lifecycle

`scoped` state follows a SwiftUI `@State`-style presence lifecycle: when the user pushes screen B on top of A and then pops back to A, B's scoped state is pruned — A's survives. Retention tracks **tree presence** (all entries, not only visible), so inactive tab branches and hidden split columns retain their state while they remain in the tree. `createNavigationScopedState` holds the map; `prune(presentKeys)` discards every entry whose `entryKey` is no longer present, mirroring the SwiftUI view lifecycle.

### Pluggable Storage, default sessionStorage, auto + manual capture

`SessionStore` (via `createSessionStore`) orchestrates `capture` / `persist` / `load` / `restore` / `clear` / `save`. Storage defaults to the browser's `sessionStorage` (via `createWebStorage("session")`), swappable to `localStorage` or any `Storage`-shaped object. Auto-capture fires on navigation change (debounced, 500 ms default) and flushes immediately on `pagehide` / `visibilitychange=hidden`. Manual `save()` / `clear()` are available as escape hatches. Provider errors are isolated (one throwing provider does not block others); Storage quota errors are silently swallowed.

### Browser bridge + startBrowserApp opt-in

`createSessionBridge` wires auto-capture events, scope pruning on navigation change, and boot restore with a configurable `shouldRestore` predicate (`defaultShouldRestore` enforces the flat deep-link policy: restore only when the current URL matches or is the root `/`; structured trees restore only from root). `startBrowserApp` gains an optional `session` config block (`providers`, `storage`, `version`, `maxAgeMs`, `debounceMs`, `shouldRestore`) and an `onSessionReady` callback that receives the live `SessionHandle`. Without `session`, the existing startup path is unchanged.

### Flat + structured support

A `SessionNavigationAdapter` interface decouples the store from navigation shape. `createNavigationSessionAdapter(controller)` handles structured trees (serializes via `serializeNavigation`, hydrates via `controller.hydrate`). `createUrlSessionAdapter({ currentUrl, navigate })` handles flat single-page apps (captures the current URL string, navigates on restore). Both share the same `SessionStore` / `SessionBridge` machinery; flat apps need no `defineNavigation` call.
