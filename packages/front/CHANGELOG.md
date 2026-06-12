# @finesoft/front

## 0.5.0

### Minor Changes

- 00e04ce: feat(router): typed route params follow-up — array-form key safety, optional-key inference, multi-value query, auto-typed handlers

  - `defineRoutes([...])` array-object form now constrains each route's `params` keys to its own `path` literal (compile error on a param-name typo), matching the existing `route()` helper.
  - `optional()` / `withDefault()` now render the param as an **optional property** (`page?: T` instead of `page: T | undefined`) in `InferParams` / `InferQuery`.
  - New `list(item, { min?, max? })` codec for **multi-value query** (`?tag=a&tag=b` → `T[]`); `Router.resolve` collects all values for keys backed by a `list()` codec.
  - New `defineRoute(path, { handler, params, query, fallback? })` — a functional route whose `handler` params are **auto-typed** from the codecs, with no hand-written `InferParams<typeof …>`. Mirrors `BaseController`'s `try/catch → fallback`.

  All additive and backward-compatible: routes without `params` / `query` are unchanged.

### Patch Changes

- Auto-generated patch release from CI (00e04ce).

## 0.4.3

### Patch Changes

- Auto-generated patch release from CI (a132ebb).

## 0.4.2

### Patch Changes

- Auto-generated patch release from CI (bec308e).

## 0.4.1

### Patch Changes

- Auto-generated patch release from CI (650b132).

## 0.4.0

### Minor Changes

- 7533e2d: Add UI-agnostic session restoration — serialize "what the user was doing" (navigation position + app-global state slices + navigation-scoped per-screen state) to a pluggable `Storage` and rehydrate it on a fresh load (hard-reload / tab crash / close-and-return), for both flat single-page and structured navigation apps. The framework owns the snapshot lifecycle; the app declares what to capture via `SessionStateProvider` and the framework orchestrates timing, persistence, versioning, and error isolation. Absent a `session` config, `startBrowserApp` is byte-for-byte unchanged.

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

### Patch Changes

- Auto-generated patch release from CI (7533e2d).

## 0.3.0

### Minor Changes

- d13b834: Add structured navigation state to the SSR/CSR framework — a recursive, UI-agnostic navigation tree (`LeafNode` / `StackNode` / `TabsNode` / `SplitNode`) analogous to SwiftUI `NavigationStack` / `TabView` / `NavigationSplitView`. The framework owns navigation state, URL/history/SSR integration, and per-destination intent dispatch; the app renders however it likes and `Page` stays content-agnostic. A single `LeafNode` is exactly today's flat single-page behavior, so existing apps are unaffected.

  ### Navigation tree + pure operations

  `leaf` / `stack` / `tabs` / `split` constructors with `is*Node` guards, plus immutable, structural-sharing operations: `push` / `pop` / `popToRoot` / `popTo` / `replaceTop` / `selectTab` / `selectColumn` / `setVisibility`, and queries `collectVisibleDestinations` / `visibleSplitColumns` / `resolveActivePath` / `findNode` / `findNearestStack`. Invalid targets throw `NavigationError`. Split views carry a serializable `visibility` (`automatic` / `all` / `doubleColumn` / `detailOnly`, mirroring SwiftUI's `NavigationSplitViewVisibility`) that narrows which columns are visible — and therefore prefetched — so a `detailOnly` deep link resolves only the detail column on the server.

  ### NavigationController mirrors the existing lifecycle

  `createNavigationController({ intentDispatcher, router, initial, createContext, beforeLoad?, afterLoad?, prefetched? })` runs the same `beforeLoad -> dispatch -> afterLoad` middleware sequence as the existing flat runner, per newly-visible destination, reusing unchanged pages and SSR-prefetched results.

  ### Serialization, codecs, SSR/CSR wiring

  `serializeNavigation` / `deserializeNavigation` (lossless round-trip), pluggable `NavigationCodec` (`createActiveLeafCodec` default, `createFullStateCodec` for full deep-linking), a browser history bridge (`createNavigationBridge`, optional `navigation` field on `startBrowserApp`), and SSR prefetch of all visible destinations via the existing `PrefetchedIntents` channel (`ssrRenderNavigation` / `createSSRNavigationRender`, with `extractNavigationTree` / `stripNavigationTree` hydration helpers). Declare the structure with the new optional `defineNavigation(...)`.

### Patch Changes

- Auto-generated patch release from CI (9c1df98).

## 0.2.0

### Minor Changes

- 2aea060: Secure-by-default SSRF defense and prefetch allowlist; new safeErrorPage and request-scoped DI helpers.

  This release adds the defaults a CTF-style adversarial drill (see `adversarial/`) showed the framework was missing. Driven by what attackers actually walked through.

  ### `HttpClient` now refuses internal hosts by default (potentially breaking)

  `HttpClient` and the new `DEP_KEYS.SAFE_FETCH` reject loopback / RFC1918 / RFC4193 / IPv4-mapped IPv6 / decimal+hex+octal IPv4 / multicast / reserved-range targets before any request is sent. Hostnames are DNS-resolved (Node only) and each resolved IP is checked, so `localtest.me`-style rebinding is blocked too.

  **Opt-out** for legitimate internal calls:

  ```ts
  new HttpClient({
    baseUrl: "http://127.0.0.1:9999",
    allowInternalHosts: true,
  });
  container.resolve(DEP_KEYS.FETCH); // the raw, unguarded fetch is still available
  ```

  Catch `HostGuardError` to give a business-friendly error.

  ### `markPublic(page, fields)` declares which page fields the client may see

  Add a Symbol-based marker to your `BasePage` return value so `serializeServerData` only emits whitelisted fields into the SSR HTML. Unmarked pages keep the old all-fields behaviour for back-compat, with a one-time dev warning. A future major will default to BasePage-only fields.

  ```ts
  import { markPublic } from "@finesoft/front";

  return markPublic(
    { ...user, apiToken: user.apiToken }, // apiToken stays server-side
    ["id", "pageType", "title", "email"] // only these enter the HTML
  );
  ```

  `serializeServerData` also accepts `{ onUnmarkedPage: "base-fields" | "strict" }` for stricter pipelines.

  ### `safeErrorPage({ status, publicMessage, devError })` for error pages

  Returns a `BasePage` whose `description` is the safe message in production and only includes `devError` (stack/path/etc.) when `NODE_ENV !== "production"`. Use it in `getErrorPage`, in `BaseController.fallback`, anywhere you currently splat `error.stack` into a page.

  ### `defineRequestScopedKey<T>(key)` typed handle for per-request DI state

  Makes the "request-scoped" path the obvious path so middleware authors stop reaching for `let lastUser` at module scope:

  ```ts
  export const CURRENT_USER = defineRequestScopedKey<TracedUser | null>(
    "app.user"
  );

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

- 284a4a7: Add typed route params: zero-dependency built-in param primitives (`int`, `str`, `num`, `bool`, `oneOf`, `uuid`) and modifiers (`optional`, `withDefault`) that implement the Standard Schema interface, plus support for any Standard Schema validator (zod/valibot/arktype). The new `route()` helper constrains `params` keys to the path's `:param` names at compile time. `Router.resolve` / `Framework.routeUrl` are now async; param/query validation failure falls through to the existing 404 path. `Intent.params` is widened to `Record<string, unknown>`.

### Patch Changes

- Auto-generated patch release from CI (284a4a7).

## 0.1.78

### Patch Changes

- Auto-generated patch release from CI (947b886).

## 0.1.77

### Patch Changes

- Auto-generated patch release from CI (14b6d0d).

## 0.1.76

### Patch Changes

- Auto-generated patch release from CI (0e23e86).

## 0.1.75

### Patch Changes

- Auto-generated patch release from CI (0c6fba3).

## 0.1.74

### Patch Changes

- Auto-generated patch release from CI (abd806e).

## 0.1.73

### Patch Changes

- Auto-generated patch release from CI (c5ba921).

## 0.1.72

### Patch Changes

- Auto-generated patch release from CI (d392184).

## 0.1.71

### Patch Changes

- Auto-generated patch release from CI (69da0a7).

## 0.1.70

### Patch Changes

- Auto-generated patch release from CI (6fa91d9).

## 0.1.69

### Patch Changes

- Auto-generated patch release from CI (273e3ce).

## 0.1.68

### Patch Changes

- Auto-generated patch release from CI (bd99c36).

## 0.1.67

### Patch Changes

- Auto-generated patch release from CI (2c7f870).

## 0.1.66

### Patch Changes

- Auto-generated patch release from CI (c1fb737).

## 0.1.65

### Patch Changes

- Auto-generated patch release from CI (74db642).

## 0.1.64

### Patch Changes

- Auto-generated patch release from CI (d6fde8a).

## 0.1.63

### Patch Changes

- Auto-generated patch release from CI (40df7ec).

## 0.1.62

### Patch Changes

- Auto-generated patch release from CI (16db734).

## 0.1.61

### Patch Changes

- Auto-generated patch release from CI (0e81a10).

## 0.1.60

### Patch Changes

- Auto-generated patch release from CI (d0b4b1d).

## 0.1.59

### Patch Changes

- Auto-generated patch release from CI (98f197b).

## 0.1.58

### Patch Changes

- Auto-generated patch release from CI (7052441).

## 0.1.57

### Patch Changes

- Auto-generated patch release from CI (2780749).

## 0.1.56

### Patch Changes

- Auto-generated patch release from CI (a74e6ab).

## 0.1.55

### Patch Changes

- Auto-generated patch release from CI (e13082b).

## 0.1.54

### Patch Changes

- Auto-generated patch release from CI (97c5969).

## 0.1.53

### Patch Changes

- Auto-generated patch release from CI (a7ff8c4).

## 0.1.52

### Patch Changes

- Auto-generated patch release from CI (29e15e5).

## 0.1.51

### Patch Changes

- Auto-generated patch release from CI (93e4489).

## 0.1.50

### Patch Changes

- Auto-generated patch release from CI (3424385).

## 0.1.49

### Patch Changes

- Auto-generated patch release from CI (09ab4cc).

## 0.1.48

### Patch Changes

- Auto-generated patch release from CI (b612fcd).

## 0.1.47

### Patch Changes

- Auto-generated patch release from CI (c7250a5).

## 0.1.46

### Patch Changes

- Auto-generated patch release from CI (18dc81e).

## 0.1.45

### Patch Changes

- Auto-generated patch release from CI (463c9ab).

## 0.1.44

### Patch Changes

- Auto-generated patch release from CI (45dc187).

## 0.1.43

### Patch Changes

- Auto-generated patch release from CI (87e2864).

## 0.1.42

### Patch Changes

- Auto-generated patch release from CI (e76527b).

## 0.1.41

### Patch Changes

- Auto-generated patch release from CI (ee67817).

## 0.1.40

### Patch Changes

- Auto-generated patch release from CI (38e5901).

## 0.1.39

### Patch Changes

- Auto-generated patch release from CI (ef165f0).

## 0.1.38

### Patch Changes

- Auto-generated patch release from CI (344779b).

## 0.1.37

### Patch Changes

- Auto-generated patch release from CI (e19d56a).

## 0.1.36

### Patch Changes

- Auto-generated patch release from CI (2c77930).

## 0.1.35

### Patch Changes

- Auto-generated patch release from CI (572fd26).

## 0.1.34

### Patch Changes

- Auto-generated patch release from CI (9969f11).

## 0.1.33

### Patch Changes

- Auto-generated patch release from CI (be9248c).

## 0.1.32

### Patch Changes

- Auto-generated patch release from CI (c513e01).

## 0.1.31

### Patch Changes

- Auto-generated patch release from CI (9a77b84).

## 0.1.30

### Patch Changes

- Auto-generated patch release from CI (833f32c).

## 0.1.29

### Patch Changes

- Auto-generated patch release from CI (90a2b0b).

## 0.1.28

### Patch Changes

- Auto-generated patch release from CI (25582d9).

## 0.1.27

### Patch Changes

- Auto-generated patch release from CI (6987a1b).

## 0.1.26

### Patch Changes

- Auto-generated patch release from CI (f959778).

## 0.1.25

### Patch Changes

- Auto-generated patch release from CI (40ae444).

## 0.1.24

### Patch Changes

- Auto-generated patch release from CI (2d7deec).

## 0.1.23

### Patch Changes

- Auto-generated patch release from CI (af8a3ee).

## 0.1.22

### Patch Changes

- Auto-generated patch release from CI (9814cb0).

## 0.1.21

### Patch Changes

- Auto-generated patch release from CI (6991334).

## 0.1.20

### Patch Changes

- Auto-generated patch release from CI (dc5cb52).

## 0.1.19

### Patch Changes

- Auto-generated patch release from CI (50c7b0c).

## 0.1.18

### Patch Changes

- Auto-generated patch release from CI (86f3e83).

## 0.1.17

### Patch Changes

- Auto-generated patch release from CI (956cc9a).

## 0.1.16

### Patch Changes

- Auto-generated patch release from CI (c94b823).

## 0.1.15

### Patch Changes

- Auto-generated patch release from CI (43d78ce).

## 0.1.14

### Patch Changes

- Auto-generated patch release from CI (74ac3f2).

## 0.1.13

### Patch Changes

- Auto-generated patch release from CI (937fe66).

## 0.1.12

### Patch Changes

- Auto-generated patch release from CI (280e5bf).

## 0.1.11

### Patch Changes

- Auto-generated patch release from CI (82dbe55).

## 0.1.10

### Patch Changes

- Auto-generated patch release from CI (0329004).

## 0.1.9

### Patch Changes

- Auto-generated patch release from CI (a72e3f7).

## 0.1.8

### Patch Changes

- Auto-generated patch release from CI (07556fc).

## 0.1.7

### Patch Changes

- Auto-generated patch release from CI (f5c2044).

## 0.1.6

### Patch Changes

- Auto-generated patch release from CI (0f3bb96).

## 0.1.5

### Patch Changes

- Auto-generated patch release from CI (804c24c).

## 0.1.4

### Patch Changes

- Fix DTS build and release workflow issues so the published package can be released reliably from CI.

## 0.1.2

### Patch Changes

- Fix: bundle all internal sub-packages inline so npm install works without requiring unpublished dependencies

## 0.1.1

### Patch Changes

- Add README documentation
