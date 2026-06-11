# 11. Navigation

Chapters 2–4 cover the **flat single-page** lifecycle: one URL → one intent → one page. This chapter adds **structured navigation** — a recursive, UI-agnostic navigation tree analogous to SwiftUI's `NavigationStack`, `TabView`, and `NavigationSplitView`.

The framework owns navigation **state**, URL/history wiring, and per-destination intent dispatch. It ships **no UI**. Your `Page` models stay exactly as content-agnostic as before — you render tabs, stacks, and split views however you like with Svelte, React, or Vue.

A single-leaf tree is **byte-for-byte** the flat single-page behavior, so this is fully opt-in: apps that never call `defineNavigation` are unaffected.

## The mental model

Navigation state is a tree of four node kinds:

```
NavigationNode = LeafNode | StackNode | TabsNode | SplitNode
```

| Node        | Holds                             | Meaning                                                       | SwiftUI               |
| ----------- | --------------------------------- | ------------------------------------------------------------- | --------------------- |
| `LeafNode`  | `intent` + `params`               | One destination (one intent dispatch)                         | a destination view    |
| `StackNode` | ordered `entries[]`               | A path: `entries[0]` is the root, the last is the visible top | `NavigationStack`     |
| `TabsNode`  | `active` key + `branches`         | Parallel branches; **only the active one is visible**         | `TabView`             |
| `SplitNode` | `columns[]` + optional `visibility` | Side-by-side columns; visible set is **all columns by default**, narrowable to `detailOnly` / `doubleColumn` | `NavigationSplitView` |

A leaf carries `intent` + `params`, **not** a `Page`. The tree is pure, serializable data describing _where_ to go; the controller produces _what's there_ (the `Page`) during resolution and hands it back in a snapshot. This is what keeps the tree URL- and history-friendly.

Interior nodes nest recursively — a `TabView` of `NavigationStack`s, a split whose detail column is a stack, and so on.

## Declaring a tree

Constructors live alongside everything else in `@finesoft/front`:

```ts
import { leaf, stack, tabs, split } from "@finesoft/front";

// A single destination — equivalent to today's flat page
leaf("home");
leaf("product", { id: 42 });

// A stack: root only, or root + already-pushed entries
stack(leaf("feed"));
stack([leaf("feed"), leaf("post", { id: 7 })]);

// Tabs: each branch is its own stack
tabs({
    active: "home",
    branches: {
        home: stack(leaf("home")),
        search: stack(leaf("search")),
        me: stack(leaf("me")),
    },
});

// Split: sidebar + detail, where detail is a stack
split([
    { id: "sidebar", content: leaf("folders") },
    { id: "detail", content: stack(leaf("folder", { id: "inbox" })) },
]);
```

`tabs()` derives a stable tab `order` from the `branches` insertion order unless you pass `order` explicitly. `stack()` accepts a single root node or an array of entries.

## A TabView of NavigationStacks

The most common shape: a bottom tab bar where each tab keeps its own navigation depth.

```ts
// src/bootstrap.ts
import { type Framework, defineRoutes, defineNavigation, leaf, stack, tabs } from "@finesoft/front";
import { HomeController } from "./lib/controllers/home";
import { SearchController } from "./lib/controllers/search";
import { ProfileController } from "./lib/controllers/profile";
import { PostController } from "./lib/controllers/post";

export function bootstrap(framework: Framework): void {
    defineRoutes(framework, [
        { path: "/", intentId: "home", controller: new HomeController() },
        { path: "/search", intentId: "search", controller: new SearchController() },
        { path: "/me", intentId: "me", controller: new ProfileController() },
        { path: "/posts/:id", intentId: "post", controller: new PostController() },
    ]);
}

// The navigation structure, declared once
export const navigation = defineNavigation({
    initial: tabs({
        active: "home",
        branches: {
            home: stack(leaf("home")),
            search: stack(leaf("search")),
            me: stack(leaf("me")),
        },
    }),
});
```

`defineNavigation` returns a normalized definition with two adapters — `toBrowserConfig()` for CSR and `toSSRDefinition()` for SSR — so you declare the tree **once** and hand the right shape to each runner.

### Wiring it into the browser

`startBrowserApp` gains an optional `navigation` field and an `onNavigationReady` callback that hands you a `NavigationHandle`:

```ts
// src/main.ts
import { startBrowserApp, type NavigationHandle } from "@finesoft/front";
import { bootstrap, navigation } from "./bootstrap";
import { mount } from "./lib/mount";

let handle: NavigationHandle;

startBrowserApp({
    bootstrap,
    mount,
    callbacks,
    navigation: navigation.toBrowserConfig(),
    onNavigationReady(h) {
        handle = h;
        // Re-render whenever the snapshot changes
        h.subscribe((snapshot) => mountNavigation(snapshot));
        mountNavigation(h.getSnapshot());
    },
});
```

When `navigation` is present, the framework builds a `NavigationController` and a history bridge, resolves the first screen, and gives you the handle. When it's absent, `startBrowserApp` runs the original flat single-page path unchanged.

## Driving navigation

The `NavigationHandle` exposes the operations. Each returns a `Promise<NavigationSnapshot>` (the committed tree plus every visible destination's resolved `Page`) and, in the browser, writes the new state to history/URL.

```ts
// Push a destination onto the active stack
await handle.push("post", { id: 7 });

// Pop back
await handle.pop(); // one level
await handle.pop(2); // two levels — never past the stack root
await handle.popToRoot();

// Replace the current top (e.g. login → dashboard without a back step)
await handle.replaceTop("dashboard");

// Switch the active tab — the other tabs keep their stack depth
await handle.selectTab("search");
```

`pop` never pops below a stack's root entry. With no explicit target, stack operations act on the **deepest active stack** (the one currently visible), and `selectTab` acts on the **outermost** tabs node — exactly what you want for a tab bar driving the focused stack.

### Reading the result

A `NavigationSnapshot` is what you render:

```ts
const snapshot = handle.getSnapshot();
snapshot.tree; // the current NavigationNode tree
snapshot.destinations; // ResolvedDestination[]: { intent, params, page, status? }
```

`destinations` is ordered to match `collectVisibleDestinations(tree)`: a tabs node contributes **only** its active branch, a split contributes **every** non-empty column. That ordering is also exactly what gets prefetched on the server.

Your view layer walks `snapshot.tree` to lay out the chrome (which tabs exist, how deep each stack is) and reads `snapshot.destinations` for the page content. The framework never tells you _how_ to draw any of it.

## A NavigationSplitView

A split view shows multiple columns at once — the classic sidebar + detail (+ sub-detail) layout. Selecting in one column drives the next.

```ts
export const navigation = defineNavigation({
    initial: split([
        { id: "sidebar", content: leaf("mailboxes") },
        { id: "list", content: undefined }, // chosen later
        { id: "detail", content: undefined },
    ]),
});
```

Use `selectColumn(columnId, intent, params?)` to set a column's content:

```ts
// Pick a mailbox → fills the "list" column
await handle.selectColumn("list", "messages", { mailbox: "inbox" });

// Pick a message → fills the "detail" column
await handle.selectColumn("detail", "message", { id: 1024 });

// Re-pick a mailbox → clears "list" AND "detail" (everything after it)
await handle.selectColumn("list", "messages", { mailbox: "archive" });

// Clear a column explicitly by passing undefined for the intent
await handle.selectColumn("detail", undefined);
```

Setting a column **clears every column after it**. Re-choosing the sidebar correctly invalidates the open detail, so you never render a stale "old detail with a new sidebar" combination.

By default every column is visible, so the snapshot's `destinations` contains one entry **per non-empty column** — the framework dispatches (and on the server, prefetches) each of them.

### Column visibility

Mirroring SwiftUI's `NavigationSplitViewVisibility`, a split carries an optional **visibility** — bindable, serializable navigation state (not styling) that decides which columns count as visible, and therefore what gets prefetched on the server:

| `visibility`   | Visible columns                  |
| -------------- | -------------------------------- |
| `automatic` (default) / `all` | every column        |
| `doubleColumn` | first + last (hides the middle)  |
| `detailOnly`   | last (detail) only               |

```ts
import { SPLIT_VISIBILITIES, visibleSplitColumns } from "@finesoft/front";

// Declare it up front (e.g. deep-link straight to the detail)
split([{ id: "sidebar", content: leaf("mailboxes") }, { id: "detail", content: leaf("message", { id: 7 }) }],
    SPLIT_VISIBILITIES.DETAIL_ONLY);

// Or change it at runtime — newly-visible columns are dispatched, hidden ones are dropped from the snapshot
await handle.setVisibility(SPLIT_VISIBILITIES.DETAIL_ONLY); // only the detail destination remains
await handle.setVisibility(SPLIT_VISIBILITIES.ALL);          // re-prefetches sidebar + list

// Render only the visible columns without re-implementing the mapping
for (const col of visibleSplitColumns(splitNode)) renderColumn(col);
```

`detailOnly` deep-links resolve and prefetch **only** the detail column on the server — the hidden columns cost nothing until shown. Compact-width collapse (SwiftUI's `preferredCompactColumn`) is viewport-reactive rendering, so it stays entirely in your hands; read `getPlatform()` / the viewport and collapse the split into a stack view however you like.

## Targeting a nested container

When a tree has more than one stack/tabs/split, pass an explicit `target` path to operate on a deeper one. A path is a list of steps from the root:

```ts
import type { NavigationPath } from "@finesoft/front";

// The stack inside the detail column of a split
const detailStack: NavigationPath = [
    { kind: "column", id: "detail" },
    { kind: "stack-entry", index: 0 },
];

await handle.push("attachment", { id: 3 }, { target: detailStack });
await handle.selectTab("photos", someTabsPath);
```

Without a `target`, operations default to the active path, which is the right choice the vast majority of the time.

## Pure operations (no controller needed)

Everything above is backed by pure, immutable tree functions you can use directly — for tests, optimistic computation, or building your own controller:

```ts
import {
    push,
    pop,
    selectTab,
    collectVisibleDestinations,
    resolveActivePath,
} from "@finesoft/front";

const next = push(tree, leaf("post", { id: 7 })); // returns a new tree
const visible = collectVisibleDestinations(next); // readonly LeafNode[]
const activePath = resolveActivePath(next);
```

These never mutate their input — only the nodes on the changed path are rebuilt; the rest of the tree is shared by reference. Invalid targets (e.g. `selectTab` on a non-tabs node, popping an empty stack target) throw a `NavigationError`.

## Server-side rendering

SSR prefetches **all** visible destinations and serializes them — plus the tree itself — into the HTML, so the browser's first render reuses the server result without refetching. Multi-column split views naturally prefetch multiple intents.

Use `createSSRNavigationRender` with the SSR adapter:

```ts
// src/ssr.ts
import { createSSRNavigationRender } from "@finesoft/front";
import { bootstrap, navigation } from "./bootstrap";
import { renderApp } from "./lib/render";

export const render = createSSRNavigationRender({
    bootstrap,
    getErrorPage: (status, message) => ({
        id: `error-${status}`,
        pageType: "error",
        title: message,
    }),
    renderApp, // (page, framework, snapshot) => { html, head, css }
    navigation: navigation.toSSRDefinition(),
});
```

`renderApp` receives three arguments: the **primary** page (the active leaf's result — compatible with the flat SSR `renderApp` signature), the framework, and the full multi-region `snapshot` so you can render tabs/split layouts:

```ts
function renderApp(page, framework, snapshot) {
    // page         → the focused destination (e.g. for <title>, status)
    // snapshot.tree         → which tabs/columns to draw
    // snapshot.destinations → the Page for each visible region
    return renderYourFramework(snapshot);
}
```

How it works under the hood: each visible destination is serialized through the **existing** `PrefetchedIntents` channel as a normal `{ intent, data: page }` entry, plus one sentinel entry carrying the serialized tree. `@finesoft/server` needs **zero changes** — it transports the sentinel through the same `#serialized-server-data` script. On hydration the browser bridge reads the tree back from history state (or the sentinel) and reuses the prefetched pages.

If a request has no structural deep-link and your app provides no skeleton, SSR falls back to `Router.resolve(url)` → a single leaf — i.e. today's flat single page, including its `renderMode`. The 404 path is unchanged.

## Deep-linking with `createFullStateCodec`

By default, the **active leaf** drives the URL (`/posts/7`) and the full tree travels via history state — clean, shareable URLs for the focused destination. To encode the **entire** tree into the URL for full deep-linking (sharing a link that restores tabs, stack depth, and split selections), opt into `createFullStateCodec`:

```ts
import { createFullStateCodec } from "@finesoft/front";

export const navigation = defineNavigation({
    initial: tabs({
        active: "home",
        branches: { home: stack(leaf("home")), me: stack(leaf("me")) },
    }),
    codec: createFullStateCodec(), // whole tree → "?__nav=..." query param
});
```

Now URLs look like `/me?__nav=<encoded-tree>`, and pasting one restores the complete navigation state on both SSR and the browser. The encoding is compact (base64url), stable (sorted keys, so the same tree always yields the same string), and lossless. Pass `createFullStateCodec({ param: "nav" })` to rename the reserved query parameter.

You can also implement a custom `NavigationCodec` if you need a bespoke URL scheme — both built-ins only depend on the router's `getRoutes()` (and optional `reverse()`), nothing more.

## Guards still work

Navigation-level `beforeLoad` / `afterLoad` guards run for the **primary** destination (the active leaf) on every navigation, with the same `redirect` / `rewrite` / `deny` semantics as [chapter 3](./03-middleware.md):

```ts
export const navigation = defineNavigation({
    initial: tabs({
        active: "home",
        branches: { home: stack(leaf("home")), me: stack(leaf("me")) },
    }),
    beforeLoad: [authGuard],
});
```

- `redirect` → handled as an in-app navigation (the browser reuses the FlowAction pipeline); the target isn't dispatched.
- `rewrite` → the new URL is re-resolved into the destination's intent/params.
- `deny` → the destination is marked with the deny status and its intent is not dispatched.

A single destination's dispatch failure never throws out of an operation — it records a `status` and a fallback page on that destination (the same `fallback` safety net as controllers), so one failing split column can't blank the whole screen.

## Backward compatibility

- Apps that don't pass `navigation` to `startBrowserApp` / `createSSRRender` run the **original flat path** with zero behavior change.
- A single-leaf tree is equivalent to the flat single page: one visible destination, one resolve/dispatch, one before/after pass. SSR only adds the tree sentinel to `serverData` (stripped before it reaches `PrefetchedIntents`).
- `Page` stays content-agnostic. Navigation adds structure _around_ your pages; it never dictates their shape or how you render them.

## Next

- [Middleware](./03-middleware.md) — the guard semantics navigation reuses
- [Rendering & hydration](./04-rendering-and-hydration.md) — how prefetched results cross the SSR → CSR boundary
