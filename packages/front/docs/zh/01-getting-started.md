# 开始使用

根入口提供可移植运行时；页面、浏览器、SSR 和平台使用独立入口。只安装所选 UI 的依赖。仓库六个 React、Vue、Svelte 模板与脚手架使用相同声明。Node 需满足 `^22.18.0 || >=24.11.0`，开发工具统一通过 Vite+ 调用。

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

`Home`、`ErrorPage` 是接收 `page` 的普通业务组件。Vue 对应 `createVueRenderer` / `createVueSSRRender`；Svelte 对应 `createSvelteRenderer` / `createSvelteSSRRender`。SSR body/data 占位符放在应用挂载目标内部。运行 `vp install`、`vp run dev`、`vp run build`。路由发现读取构建后 renderer 的 `render.routes`。静态构建需要显式路由模块时，可使用 `staticAdapter({ routesExport: "src/app-definition.ts" })`。
