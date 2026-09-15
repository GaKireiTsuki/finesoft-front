# Getting started

Use the published portable root and explicit environment entries. Install only the UI peers you select. The six repository templates contain complete React, Vue and Svelte examples; the CLI copies these same declarations. Node must satisfy `^22.18.0 || >=24.11.0`. Use Vite+ commands for development.

Choose full for products, search and guards; choose minimal for Feed, detail, Notes and session restoration. Each tier is consistent across the three frameworks; see [application structure and template contracts](./engineering/project-structure.md).

## Page controller

All six templates organize page loading with `BaseController`. Import it from the portable root for typed input, business execution and optional error recovery. Import `definePage` from `/web` for page declarations and route, navigation and view references.

`src/lib/controllers/home.ts`:

```ts
import { BaseController } from "@finesoft/front";
import { markPublic, type BasePage } from "@finesoft/front/web";

interface HomePage extends BasePage {
    pageType: "home";
}

export class HomeController extends BaseController<Record<string, string>, HomePage> {
    readonly intentId = "load-home";

    execute(): HomePage {
        return markPublic({ id: "home", pageType: "home", title: "Home" }, []);
    }
}
```

## Application declaration / 应用声明

Register a controller factory in `src/app-definition.ts`. Declaration stores the factory; actual page execution creates the controller.

```ts
import { definePage, defineWebApp } from "@finesoft/front/web";
import { HomeController } from "./lib/controllers/home";

export const home = definePage({
    id: "load-home",
    create: () => new HomeController(),
});
export const app = defineWebApp({
    id: "example",
    controllers: [home],
    routes: [home.route("/")],
    getErrorPage: (status, message) => ({ id: String(status), pageType: "error", title: message }),
});
```

Simple pages can also use `definePage({ id, handler })`. Both forms use the same runtime; `BaseController` additionally supplies the `execute()` → `fallback()` class contract. See [routes, controllers and typed pages](./02-routing-and-controllers.md).

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
            ssr: { entry: "src/ssr.ts" },
        }),
    ],
});
```

`Home` and `ErrorPage` are ordinary application components receiving a `page` prop. Vue uses `createVueRenderer` / `createVueSSRRender`; Svelte uses `createSvelteRenderer` / `createSvelteSSRRender`. Put the SSR body/data placeholders inside the chosen app target. Run `vp install`, `vp run dev`, then `vp run build`. Route discovery reads the built renderer’s `render.routes`. Static builds can use `staticAdapter({ routesExport: "src/app-definition.ts" })` for an explicit route module.
