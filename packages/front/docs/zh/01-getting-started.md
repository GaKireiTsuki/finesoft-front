# 开始使用

根入口提供可移植运行时；页面、浏览器、SSR 和平台使用独立入口。只安装所选 UI 的依赖。仓库六个 React、Vue、Svelte 模板与脚手架使用相同声明。Node 需满足 `^22.18.0 || >=24.11.0`，开发工具统一通过 Vite+ 调用。

选择 full 可查看商品、搜索和守卫示例；选择 minimal 可查看 Feed、详情、Notes 及会话恢复。同档位的三框架模板保持一致，详见[应用结构与模板约定](./engineering/project-structure.md)。

## 页面控制器

六个模板都通过 `BaseController` 组织页面加载逻辑。它从根入口导入，负责类型化输入、业务执行和可选的错误回退；`definePage` 从 `/web` 导入，负责页面声明及路由、导航和视图引用。

`src/lib/controllers/home.ts`：

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

`src/app-definition.ts` 注册控制器工厂。真正加载页面时才创建控制器，声明阶段只保存工厂。

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

简单页面也可以使用 `definePage({ id, handler })`。两种写法进入同一套运行时；`BaseController` 另外提供 `execute()` → `fallback()` 的类实现约定。详见[路由、控制器与类型化页面](./02-routing-and-controllers.md)。

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

`Home`、`ErrorPage` 是接收 `page` 的普通业务组件。Vue 对应 `createVueRenderer` / `createVueSSRRender`；Svelte 对应 `createSvelteRenderer` / `createSvelteSSRRender`。SSR body/data 占位符放在应用挂载目标内部。运行 `vp install`、`vp run dev`、`vp run build`。路由发现读取构建后 renderer 的 `render.routes`。静态构建需要显式路由模块时，可使用 `staticAdapter({ routesExport: "src/app-definition.ts" })`。
