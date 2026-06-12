---
"@finesoft/front": minor
---

Add structured navigation state to the SSR/CSR framework — a recursive, UI-agnostic navigation tree (`LeafNode` / `StackNode` / `TabsNode` / `SplitNode`) analogous to SwiftUI `NavigationStack` / `TabView` / `NavigationSplitView`. The framework owns navigation state, URL/history/SSR integration, and per-destination intent dispatch; the app renders however it likes and `Page` stays content-agnostic. A single `LeafNode` is exactly today's flat single-page behavior, so existing apps are unaffected.

### Navigation tree + pure operations

`leaf` / `stack` / `tabs` / `split` constructors with `is*Node` guards, plus immutable, structural-sharing operations: `push` / `pop` / `popToRoot` / `popTo` / `replaceTop` / `selectTab` / `selectColumn` / `setVisibility`, and queries `collectVisibleDestinations` / `visibleSplitColumns` / `resolveActivePath` / `findNode` / `findNearestStack`. Invalid targets throw `NavigationError`. Split views carry a serializable `visibility` (`automatic` / `all` / `doubleColumn` / `detailOnly`, mirroring SwiftUI's `NavigationSplitViewVisibility`) that narrows which columns are visible — and therefore prefetched — so a `detailOnly` deep link resolves only the detail column on the server.

### NavigationController mirrors the existing lifecycle

`createNavigationController({ intentDispatcher, router, initial, createContext, beforeLoad?, afterLoad?, prefetched? })` runs the same `beforeLoad -> dispatch -> afterLoad` middleware sequence as the existing flat runner, per newly-visible destination, reusing unchanged pages and SSR-prefetched results.

### Serialization, codecs, SSR/CSR wiring

`serializeNavigation` / `deserializeNavigation` (lossless round-trip), pluggable `NavigationCodec` (`createActiveLeafCodec` default, `createFullStateCodec` for full deep-linking), a browser history bridge (`createNavigationBridge`, optional `navigation` field on `startBrowserApp`), and SSR prefetch of all visible destinations via the existing `PrefetchedIntents` channel (`ssrRenderNavigation` / `createSSRNavigationRender`, with `extractNavigationTree` / `stripNavigationTree` hydration helpers). Declare the structure with the new optional `defineNavigation(...)`.
