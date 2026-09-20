# Rendering and hydration

SSR, CSR and prerender determine when HTML is produced. All modes use the same page session and one native application root, with layout around Outlet. There are no root/entries renderer modes or separate chrome roots.

In the browser, call `createBrowserApp({ definition, target })`, mount or hydrate the same App using native APIs, then await `app.ready`. On the server use `createSSRRender({ definition, render: app => nativeRender(app) })`. See [getting started](./01-getting-started.md) for React and the templates for Vue/Svelte.

Outlet subscribes to stable `AppSnapshot` values. EntryId keeps its wrapper stable; EntryId plus pageType determines the child component identity. Hidden entries remain in the same native tree with their drafts and context. A pageType change recreates the child. Native commit hooks acknowledge only the revision actually rendered; the browser then restores its scroll and DOM state.

SSR materializes public projections while request resources are alive and performs one native render. Hydration explicitly carries `{ tree, pages }`, with page results associated with entries. Protocol/build mismatches trigger fresh loading; persisted sessions have their own version. Denied data does not enter the wire.

CSR returns an HTML shell. Prerender produces static HTML. Runtime public HTML reuse still executes current guards and rendering, so it is not a render-skipping guarantee. During cleanup, await session disposal before unmounting the application's native root.
