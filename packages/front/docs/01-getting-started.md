# Getting started

Use the published portable root and explicit environment entries. Install only the UI peers you select. The six repository templates contain complete React, Vue and Svelte examples; the CLI copies these same declarations. Node must satisfy `^22.18.0 || >=24.11.0`. Use Vite+ commands for development.

## Application declaration / 应用声明

```ts
import { definePage, defineWebApp, markPublic } from "@finesoft/front/web";
export const home = definePage({
    id: "load-home",
    handler: () => markPublic({ id: "home", pageType: "home" as const, title: "Home" }, []),
});
export const app = defineWebApp({
    id: "example",
    controllers: [home],
    routes: [home.route("/")],
    getErrorPage: (status, message) => ({ id: String(status), pageType: "error", title: message }),
});
```

## View binding / 视图绑定

```ts
import Home from "./Home";
import ErrorPage from "./ErrorPage";
import { home } from "./app-definition";
export const views = { views: { ...home.bindView("home", Home), error: ErrorPage } };
```

## Browser entry / 浏览器入口

```ts
import { startBrowserApp } from "@finesoft/front/browser";
import { createReactRenderer } from "@finesoft/front/renderers/react/browser";
import { app } from "./app-definition";
import { views } from "./views";
export const handle = await startBrowserApp({
    app,
    target: document.getElementById("app")!,
    renderer: createReactRenderer(views),
});
// When the owning application removes this instance:
// await handle.dispose();
```

## SSR entry / SSR 入口

```ts
import { createReactSSRRender } from "@finesoft/front/renderers/react/server";
import { app } from "./app-definition";
import { views } from "./views";
export const render = createReactSSRRender({ app, renderer: views });
export { serializeServerData } from "@finesoft/front/ssr";
```

## Vite config / 构建配置

```ts
import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import { finesoftFrontViteConfig } from "@finesoft/front/vite";
export default defineConfig({
    plugins: [
        react(),
        finesoftFrontViteConfig({
            adapter: "node",
            ssr: { entry: "src/ssr.tsx" },
        }),
    ],
});
```

`Home` and `ErrorPage` are ordinary application components receiving a `page` prop. Vue uses `createVueRenderer` / `createVueSSRRender`; Svelte uses `createSvelteRenderer` / `createSvelteSSRRender`. Put the SSR body/data placeholders inside the chosen app target. Run `vp install`, `vp run dev`, then `vp run build`. Route discovery reads the built renderer’s `render.routes`. Static builds can use `staticAdapter({ routesExport: "src/app-definition.ts" })` for an explicit route module.
