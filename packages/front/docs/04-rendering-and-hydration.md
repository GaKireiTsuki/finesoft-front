# 4. Rendering & hydration

How a page travels from controller output to bytes on the wire, then back into a live browser app. This chapter covers SSR, CSR, prerender, the second axis they compose with — **app architecture** (flat single page vs structured navigation + islands) — and the `PrefetchedIntents` machinery that ties them together.

## The three modes side by side

|                             | SSR                              | CSR                              | Prerender                        |
| --------------------------- | -------------------------------- | -------------------------------- | -------------------------------- |
| When HTML is built          | Per request, on the server       | At build time (shell only)       | At build time, per route         |
| Initial body                | Fully rendered                   | Empty `<div id="app"></div>`     | Fully rendered                   |
| Initial fetch on hydration? | No (data in `PrefetchedIntents`) | Yes (controller runs in browser) | No (data in `PrefetchedIntents`) |
| TTFB                        | One controller execution         | Near-zero                        | Static file serve                |
| Personalization             | Per-request OK                   | Best — runs entirely client-side | None (same HTML for everyone)    |
| SEO                         | Good                             | Requires JS-aware crawlers       | Best                             |

Mode is **per-route**. Mix freely.

## Two axes: render mode × app architecture

Render mode is one axis. The **app architecture** is a second, orthogonal axis:

- **Flat single page** — `createSSRRender` on the server, a single client mount that re-renders on each navigation. One root, one visible page. (See [SSR pipeline](#ssr-pipeline) below.)
- **Structured navigation + islands** — `createSSRNavigationRender` on the server, per-destination _islands_ on the client: independent roots that stay alive across tab/stack switches. (See [Navigation](./11-navigation.md) and [Islands SSR](#islands-ssr-structured-architecture-approach-c) below.)

The two axes compose into a matrix — render mode decides _when/where_ HTML is produced; architecture decides _how_ the app is structured:

|               | Flat single page          | Structured nav + islands (approach C) |
| ------------- | ------------------------- | ------------------------------------- |
| **ssr**       | ✅ `svelte-minimal`       | ✅ `vue-minimal`, `react-minimal`     |
| **csr**       | ◐ shell → one client root | ◐ shell → islands mount client-side   |
| **prerender** | ◐ cached flat SSR         | ◐ cached approach-C SSR               |

✅ demonstrated by a starter template · ◐ composes by design, no starter template yet.

**Islands are SSR'd or CSR'd as a consequence of the mode, not as a separate choice:** under `ssr`/`prerender` the framework server-renders each visible island and the client _adopts and hydrates_ it; under `csr` there is no server HTML, so every island mounts fresh on the client. The per-mode sub-dimensions still apply on top — CSR has two triggers ([below](#csr-client-side-render)), prerender has build-time-static and runtime-ISR forms ([below](#prerender-static--isr)). Session restoration + DOM restore are a further orthogonal layer (client-side, post-hydration) that stacks onto any cell — see [Session restoration](./12-session-restoration.md).

## SSR pipeline

```
Request URL
    │
    ▼
Router.resolve()                 → RouteMatch
    │
    ▼
beforeLoad guards                → may rewrite (internal) / redirect / deny
    │
    ▼
IntentDispatcher.dispatch()      → Page
    │
    ▼
afterLoad guards                 → may redirect / deny / signal canonicalization
    │
    ▼
renderApp(page)                  → { html, head, css }
    │
    ▼
injectSSRContent()               → final HTML with:
    • rendered body in <!--ssr-->
    • head fragment in <!--head-->
    • serialized PrefetchedIntents in a <script> tag
    • <html lang="..." dir="..."> attributes
```

### SSR entry

```ts
// src/ssr.ts
import { createSSRRender, serializeServerData } from "@finesoft/front";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import App from "./App.vue";
import { bootstrap } from "./bootstrap";

export const render = createSSRRender({
    bootstrap,
    getErrorPage: () => ({ kind: "error", title: "Something went wrong" }),
    async renderApp(page) {
        const app = createSSRApp(App, { page });
        const html = await renderToString(app);
        return {
            html,
            head: `<title>${escape(page.title)}</title>`,
            css: "",
        };
    },
});

export { serializeServerData };
```

The Vite plugin and adapters call `render(url, options)` for you. You return `{ html, head, css }`; the framework handles injection and serialization.

### What `createSSRRender` does for you

- Runs `bootstrap()` once on the server (cached across requests in the same worker)
- Creates a request-scoped DI container per request
- Runs the middleware pipeline
- Calls your `renderApp()` to produce the body
- Serializes prefetched intent results into a `<script id="__finesoft_data__">` tag
- Sets `<html lang dir>` from the resolved locale
- Sets HTTP status from `deny()` / `redirect()` / `rewrite()` results
- Adds `Content-Location` header when `afterLoad` signaled a rewrite

## Islands SSR (structured architecture, "approach C")

The structured architecture renders the **chrome** (tab bar, headers — the persistent frame) and the **island content** (the active page) as **independent hydration roots**, placed as siblings under the mount node:

```html
<div id="app">
    <div data-fs-chrome><!-- chrome SSR'd here --></div>
    <main data-fs-outlet><!-- each visible island SSR'd here --></main>
</div>
```

**Server** — `renderApp` renders the chrome; `renderIslandsHtml(snapshot, renderEntry)` renders each visible destination into the outlet with shared markers (`data-fs-entry` / `data-fs-intent` / `data-fs-key`) so the client can match them:

```ts
// src/ssr.ts — structured entry (createSSRNavigationRender)
async renderApp(page, _framework, snapshot) {
    const chromeHtml = await renderToString(createSSRApp(App, { snapshot }));
    const islandsHtml = await renderIslandsHtml(snapshot, (entry) =>
        renderToString(createSSRApp(VIEWS[entry.intent], { page: entry.page })),
    );
    return {
        html: `<div data-fs-chrome>${chromeHtml}</div><main data-fs-outlet>${islandsHtml}</main>`,
        head: `<title>${page.title}</title>`,
        css: "",
    };
}
```

**Client** — `resolveIslandsShell(target)` locates (or creates) the chrome/outlet siblings and reports whether the chrome was server-rendered (`hydrate`). The island orchestrator adopts each SSR'd container by `data-fs-key` and calls your `mountEntry(entry, container)` with `entry.hydrate = true`, so you hydrate the existing DOM rather than create new:

```ts
// src/main.ts
const mountEntry = (entry, container) => {
    const factory = entry.hydrate ? createSSRApp : createApp; // hydrate SSR'd vs mount fresh (client nav)
    const app = factory(VIEWS[entry.intent], { page: entry.page, controller: ctx.app });
    app.mount(container);
    return { unmount: () => app.unmount() };
};

startBrowserApp({
    bootstrap,
    mount,
    callbacks,
    navigation: { ...navigation.toBrowserConfig(), mountEntry },
});
```

> **Synchronous-mount contract.** After `mountEntry` returns, the island's DOM must already exist: the framework restores `data-restore-root` fields on the next animation frame (see [Session restoration](./12-session-restoration.md)). Vue/Svelte `.mount()` satisfies this synchronously. **React** commits asynchronously, so wrap the **client-mount** path in `flushSync(() => root.render(view))` — only client-mounted islands need it (SSR'd islands already have their DOM from the server). See `templates/react-minimal/src/main.tsx`.

Complete examples: `templates/vue-minimal` and `templates/react-minimal` (both `ssr` + structured navigation + islands + session restoration).

## CSR (client-side render)

For routes marked `renderMode: "csr"`, the server returns a minimal shell:

```html
<!doctype html>
<html lang="en">
    <head>
        <!-- head injected here -->
    </head>
    <body>
        <div id="app"></div>
        <!-- no PrefetchedIntents script — controller runs in browser -->
        <script type="module" src="/src/main.ts"></script>
    </body>
</html>
```

The controller runs in the browser when `startBrowserApp()` triggers the first navigation. Use CSR for:

- Heavily personalized dashboards behind auth
- Pages where SEO doesn't matter
- Pages where server-side rendering cost outweighs the latency benefit

## Prerender (static + ISR)

```ts
{ path: "/about", intentId: "about", controller: new AboutController(), renderMode: "prerender" }
```

At build time the framework:

1. Calls `controller.execute({}, container)` (path params from the static path)
2. Runs `renderApp()` to produce HTML
3. Writes `dist/about.html` to disk

The adapter serves these static files directly. No controller runs at request time.

### Incremental Static Regeneration (ISR)

The bundled server (`createServer`) and the preview server (`vp preview`) also cache `prerender` routes at runtime: a route is rendered on its **first** request and the HTML kept in an in-memory LRU (`ISR_CACHE_MAX = 1000` entries, evicted least-recently-used). Subsequent requests serve the cached HTML without re-running the controller.

Mark routes `prerender` per route (`renderMode: "prerender"`) or per glob via the Vite plugin (config-level wins over route-level):

```ts
finesoftFrontViteConfig({
    ssr: { entry: "src/ssr.ts" },
    renderModes: { "/blog/*": "prerender" },
});
```

The runtime cache has **no TTL and no background regeneration** — entries live until LRU-evicted or the process restarts. Time-based stale-while-revalidate is delegated to the CDN by the platform adapters (Netlify emits a real `stale-while-revalidate` header; Cloudflare a plain `max-age`; node/Vercel none). See [server & deployment](./09-server-and-deployment.md#isr-incremental-static-regeneration) for the full picture.

## `PrefetchedIntents` — the SSR → CSR bridge

The crucial mechanic: **the same controller produces a page on the server, and the browser reuses that result without refetching.**

### How it works

1. SSR: controller runs, returns `Page`. The framework stores `(intentId, paramsKey) → Page` in a `PrefetchedIntents` map.
2. Render: the map is JSON-stringified into `<script id="__finesoft_data__">{...}</script>`.
3. Browser: `startBrowserApp` reads the script, calls `createPrefetchedIntentsFromDom()`, passes it to `Framework.create()`.
4. First navigation in the browser: `IntentDispatcher.dispatch()` checks the map by `(intentId, paramsKey)` — if hit, returns the cached `Page` directly without calling the controller.

### Stable key generation

The lookup key is generated from `intentId` + the **stable JSON stringification** of `params`. Object key order does not affect the key:

```ts
// These produce the same paramsKey:
dispatch({ intentId: "product", params: { id: "42", color: "red" } });
dispatch({ intentId: "product", params: { color: "red", id: "42" } });
```

If you write a controller that resolves the same logical request from different `params` shapes, factor it into a normalization step before dispatch.

### When the cache misses

- New navigation to an intent not prefetched on the server (e.g., dynamic route the user clicked)
- Stale cache after `PrefetchedIntents.invalidate(intentId, params)`
- Browser-side mutation guards (custom)

A miss falls through to the regular dispatcher path — `execute()` runs in the browser.

## Hydration step-by-step

```
Server                        Browser
──────                        ───────
bootstrap(framework)
    ▼                              │
controller.execute()                │
    ▼                              │
Page A                              │
    ▼                              │
serialize → <script>                │
    ▼                              │
HTML response ────────────────▶  Receive HTML
                                    ▼
                              createPrefetchedIntentsFromDom()
                                    ▼
                              Framework.create({ prefetchedIntents })
                                    ▼
                              bootstrap(framework)    ← same code, same routes
                                    ▼
                              dispatch(currentIntent)
                                    ▼
                              Cache hit → Page A     ← no refetch
                                    ▼
                              mount(app)
```

The bootstrap runs twice — once on each side — with identical inputs. This is what guarantees the browser-side initial route matches the server-rendered HTML.

## SSR head injection

`renderApp()` returns a `head` fragment. The framework injects it at the `<!--head-->` placeholder along with:

- `<script id="__finesoft_data__">` with serialized data (SSR mode only)
- `<link>` / `<script>` for client entry (production builds)
- `<html lang="..." dir="...">` attributes from the resolved locale

Custom meta tags go in your `head` string:

```ts
async renderApp(page) {
    return {
        html: await renderToString(/*...*/),
        head: [
            `<title>${escape(page.title)}</title>`,
            `<meta name="description" content="${escape(page.description)}">`,
            `<meta property="og:title" content="${escape(page.title)}">`,
        ].join(""),
        css: "",
    };
}
```

Always escape user-provided strings — they go straight into HTML.

## CSS injection

If your render produces critical CSS (e.g., Vue scoped styles or `vanilla-extract`), return it as `css`:

```ts
return {
    html,
    head: `<title>${title}</title>`,
    css: extractedCriticalCss, // injected as <style> in <head>
};
```

For Vite-managed stylesheets, leave `css: ""` — the Vite plugin handles them.

## Status codes

The HTTP status of the SSR response follows this priority:

1. Middleware result: `deny(404)` → 404; `redirect(url, 301)` → 301 with `Location` header.
2. Page-level: a `Page` of `kind: "error"` returned by `fallback()` results in 500 (configurable via `getErrorPage`).
3. Default: 200.

Override via `afterLoad`:

```ts
afterLoad: [
    (ctx) => {
        if (ctx.page.kind === "not-found") return deny(404, "Not found");
        return next();
    },
],
```

## Streaming SSR

Currently not supported. The framework awaits `renderApp()` fully before sending bytes. For most apps this is fine — `IntentDispatcher` parallelizes data fetching inside `execute()` if your controller awaits multiple HTTP calls together.

If you need streaming for a specific large page, consider rendering it CSR and using your view layer's own streaming primitives.

## Next

- [i18n](./05-i18n.md) — locale resolution and dictionary loading
- [Pitfalls: SSR hydration mismatch](./pitfalls/ssr-hydration-mismatch.md) — when the two sides disagree
