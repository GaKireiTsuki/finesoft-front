# 快速开始

所有框架 API 统一使用 `from "@finesoft/front"`。React、Vue、Svelte 都由应用创建一个原生根，布局和 Provider 包住 Outlet。六套模板共用此接入方式。

先安装依赖。Node 要求 `^22.18.0 || >=24.11.0`，项目工具统一使用 Vite+。full 展示商品、搜索和守卫，minimal 展示 tabs/stack、输入草稿和会话恢复。

```bash
vp dlx @finesoft/create-app my-app
vp install
```

## 页面与路由

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

## 原生应用根

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

页面组件接收 `{ page, app, entry }`，可以使用布局提供的原生 context。真实 `<a href>` 链接自动接入同一导航流程；组合操作使用 `app.perform(action)`。类式加载逻辑可选用 `BaseController.execute({ params, query, context })`。

## 浏览器入口

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

`createBrowserApp` 返回可挂载的会话；先挂载，再等待 `ready`。Outlet 在原生提交后确认版本，随后才恢复会话。不要在挂载前等待 ready。

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

Vue 使用 `Outlet("vue")`，使用 `createSSRApp` / `createApp` 与 `renderToString`；Svelte 使用 `Outlet("svelte")`，使用 `hydrate` / `mount` 与 `svelte/server` 的 `render`。参见对应模板。Svelte 在 `hydrate` 为 false 时先清空挂载目标，再执行 `mount`，避免旧的 SSR 错误页残留。

`useSnapshot("react", app)` 返回快照，`useSnapshot("vue", app)` 返回原生 ref，`useSnapshot("svelte", app)` 返回 store。选择参数必须是字符串字面量；Vite 插件把调用转换成所选原生实现的直接引用，保留组件身份、订阅与清理。

插件在初始化时生成 `.finesoft/front.d.ts`，并维护 `tsconfig.json` 中仅针对 `@finesoft/front` 的类型路径。只安装使用的 UI 依赖，现有类型提示不变。将 `.finesoft/` 加入 `.gitignore`；依赖变化后重启开发进程。独立 `tsc` 或 Node 项目先运行 `vp exec finesoft-types`，也可从统一入口调用 `generateFrontTypes({ root })`。该映射仅用于类型，运行时仍解析正式包。
