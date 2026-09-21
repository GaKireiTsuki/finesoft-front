# Getting started

All framework APIs use `from "@finesoft/front"`. The application creates one native React, Vue or Svelte root; its layout and providers surround Outlet. All six templates use this same model.

Install dependencies first. Node must satisfy `^22.18.0 || >=24.11.0`; use Vite+ for project tooling. Full demonstrates products, search and guards; minimal demonstrates tabs/stacks, drafts and session restoration.

```bash
vp dlx @finesoft/create-app my-app
vp install
```

## Page and route

```ts
// src/app-definition.ts
import { definePage, defineWebApp, markPublic } from "@finesoft/front";
export const home = definePage({
    id: "home",
    routes: ["/"],
    handler: () => markPublic({ id: "home", pageType: "home" as const, title: "Home" }, []),
});
export const app = defineWebApp({
    id: "example",
    pages: [home],
    getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
});
```

## Native application root

```tsx
// src/App.tsx
import { Outlet as selectOutlet, type WebAppView } from "@finesoft/front";
import Home from "./pages/Home";
import ErrorPage from "./pages/ErrorPage";
const Outlet = selectOutlet("react");
const views = { home: Home, error: ErrorPage };
export default function App({ app }: { app: WebAppView }) {
    return (
        <div className="layout">
            <Outlet app={app} views={views} />
        </div>
    );
}
```

Page components receive `{ page, app, entry }` and inherit native context from their layout. Real `<a href>` links use the same navigation flow; composed actions use `app.perform(action)`. Class-based loaders may use `BaseController.execute({ params, query, context })`.

## Browser entry

```tsx
// src/main.tsx
import { createBrowserApp } from "@finesoft/front";
import { createRoot, hydrateRoot } from "react-dom/client";
import { app as definition } from "./app-definition";
import App from "./App";
const target = document.getElementById("app")!;
const app = await createBrowserApp({ definition, target });
const root = app.shouldHydrate ? hydrateRoot(target, <App app={app} />) : createRoot(target);
if (!app.shouldHydrate) root.render(<App app={app} />);
await app.ready;
// Cleanup owned by the application:
// try { await app.dispose(); } finally { root.unmount(); }
```

`createBrowserApp` returns a session ready to mount. Mount first, then await `ready`. Outlet acknowledges the native commit before session restoration starts. Awaiting ready before mounting would deadlock.

## SSR

```tsx
// src/ssr.tsx
import { renderToString } from "react-dom/server";
import { createSSRRender } from "@finesoft/front";
import { app as definition } from "./app-definition";
import App from "./App";
export const render = createSSRRender({
    definition,
    render: (app) => renderToString(<App app={app} />),
});
export { serializeServerData } from "@finesoft/front";
```

## Vite

```ts
import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import { finesoftFrontViteConfig } from "@finesoft/front";
export default defineConfig({
    plugins: [react(), finesoftFrontViteConfig({ adapter: "node", ssr: { entry: "src/ssr.tsx" } })],
});
```

Vue selects `Outlet("vue")` and uses `createSSRApp` / `createApp` with `renderToString`. Svelte selects `Outlet("svelte")` and uses `hydrate` / `mount` with `render` from `svelte/server`. See the matching templates. Before a fresh Svelte `mount`, clear the target when `hydrate` is false so rejected SSR markup cannot remain beside the new app.

`useSnapshot("react", app)` returns a snapshot, `useSnapshot("vue", app)` a native ref, and `useSnapshot("svelte", app)` a store. Use a string literal for the renderer. The Vite plugin resolves the selected native implementation at build time, preserving component identity, subscriptions and cleanup.

On initialization the plugin generates `.finesoft/front.d.ts` and maintains the exact `@finesoft/front` type path in `tsconfig.json`. Only the selected UI peers are required. Ignore `.finesoft/` in Git and restart development after dependency changes. For standalone `tsc` or Node projects, run `vp exec finesoft-types` first, or call `generateFrontTypes({ root })` from the unified entry. The alias affects types only; runtime imports resolve the published package.
