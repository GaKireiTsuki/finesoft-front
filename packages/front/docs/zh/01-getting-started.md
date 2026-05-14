# 1. 快速开始

五分钟跑通一个 `@finesoft/front` 应用。读完你会有一个 Vue/React/Svelte 页面在服务端渲染、在浏览器 hydrate、并准备好部署。

## 先决条件

- Node.js `>= 22.12.0`
- 一个包管理器：pnpm（推荐）、npm 或 yarn
- 一个视图层：Vue 3、React 19 或 Svelte 5 —— 文档用 Vue 举例，但每个示例都能 1:1 翻译

## 脚手架创建新应用

```bash
npx @finesoft/create-app my-app
cd my-app
pnpm install
pnpm dev
```

脚手架生成一个可运行的应用，路由、SSR、proxy 已经接好。打开 <http://localhost:5173>。

如果你想理解里面是怎么搭起来的，本页后面从零搭一份同样的配置。

## 加进已有项目

```bash
pnpm add @finesoft/front
pnpm add -D vite hono
```

Peer 依赖：`hono >= 4.0.0`。可选但推荐：`@hono/node-server`（Node 部署）、`vite >= 5.0.0`（dev server）。

## 最小项目布局

```
my-app/
├── src/
│   ├── bootstrap.ts       # 路由 + Controller（SSR + CSR 共享）
│   ├── main.ts            # 浏览器入口
│   ├── ssr.ts             # SSR 入口
│   ├── App.vue            # 根组件
│   └── lib/
│       └── controllers/
│           └── home.ts
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig.json
```

## Vite 配置

```ts
// vite.config.ts
import { finesoftFrontViteConfig } from "@finesoft/front";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [
        vue(),
        finesoftFrontViteConfig({
            ssr: { entry: "src/ssr.ts" },
            i18n: { messagesDir: "src/locales" },
            adapter: "auto",
        }),
    ],
});
```

`finesoftFrontViteConfig` 加的东西：

- 基于 Hono 的 dev server，每个请求都跑你的 SSR 入口
- 从 `messagesDir` 自动加载 locale JSON
- 构建管线同时产出客户端 bundle 和服务端入口
- `adapter: "auto" | "node" | "vercel" | "cloudflare" | "netlify" | "static"` 自动接入平台 adapter

## Bootstrap（SSR 与 CSR 共享）

```ts
// src/bootstrap.ts
import { type Framework, defineRoutes } from "@finesoft/front";
import { HomeController } from "./lib/controllers/home";

export function bootstrap(framework: Framework): void {
    defineRoutes(framework, [{ path: "/", intentId: "home", controller: new HomeController() }]);
}
```

同一个 `bootstrap()` 在两端都跑。这就是 SSR 和 CSR 解析 URL 完全一致的保证。

## Controller

```ts
// src/lib/controllers/home.ts
import { BaseController, type Container } from "@finesoft/front";

interface HomePage {
    kind: "home";
    title: string;
    items: string[];
}

export class HomeController extends BaseController<Record<string, string>, HomePage> {
    readonly intentId = "home";

    async execute(_params: Record<string, string>, _container: Container): Promise<HomePage> {
        return {
            kind: "home",
            title: "Welcome",
            items: ["one", "two", "three"],
        };
    }

    fallback(_params: Record<string, string>, error: unknown): HomePage {
        return { kind: "home", title: "Failed", items: [] };
    }
}
```

`BaseController` 把 `execute()` 包在 `try/catch` 里，出错时调 `fallback()`。永远要写 `fallback` —— 原因见 [可观测性 · 错误处理](./08-observability.md#通过-fallback-处理错误)。

## SSR 入口

```ts
// src/ssr.ts
import { createSSRRender, serializeServerData } from "@finesoft/front";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import App from "./App.vue";
import { bootstrap } from "./bootstrap";

export const render = createSSRRender({
    bootstrap,
    getErrorPage: () => ({ kind: "error", title: "Error" }),
    async renderApp(page) {
        const html = await renderToString(createSSRApp(App, { page }));
        return { html, head: `<title>${(page as { title: string }).title}</title>`, css: "" };
    },
});

export { serializeServerData };
```

`createSSRRender` 返回一个函数，接 URL 输出渲染后的 HTML + 序列化的 prefetched intent 数据。Vite 插件和 adapter 会替你调用，不需要手动调。

## 浏览器入口

```ts
// src/main.ts
import { startBrowserApp } from "@finesoft/front/browser";
import { createSSRApp } from "vue";
import App from "./App.vue";
import { bootstrap } from "./bootstrap";

startBrowserApp({
    bootstrap,
    mount(target, { framework }) {
        const app = createSSRApp(App, { framework });
        app.mount(target);
    },
});
```

`startBrowserApp` 从 DOM 读 SSR 注入的 `PrefetchedIntents`，创建 `Framework`，跑同样的 `bootstrap()`，并触发首屏页面。`mount()` 跑的时候，框架已经准备好了初始的 `Page`。

客户端从 `@finesoft/front/browser` 导入（不是 `@finesoft/front`），避免把服务端模块带进客户端 bundle。

## 根组件（Vue 示例）

```vue
<!-- src/App.vue -->
<script setup lang="ts">
import { computed } from "vue";
import type { Framework } from "@finesoft/front";

const props = defineProps<{ framework?: Framework; page?: { title: string; items: string[] } }>();

// SSR 直接收到 page；CSR 从 framework 取当前页面。
const page = computed(() => props.page ?? props.framework?.getCurrentPage());
</script>

<template>
    <main>
        <h1>{{ page?.title }}</h1>
        <ul>
            <li v-for="item in page?.items" :key="item">{{ item }}</li>
        </ul>
    </main>
</template>
```

## index.html

```html
<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <!--head-->
    </head>
    <body>
        <div id="app"><!--ssr--></div>
        <script type="module" src="/src/main.ts"></script>
    </body>
</html>
```

`<!--head-->` 和 `<!--ssr-->` 是框架注入 head 片段和渲染 HTML 的占位。占位名也通过 `SSR_PLACEHOLDERS` 导出。

## 跑起来

```bash
pnpm dev          # 带 HMR 的开发服务器
pnpm build        # 生产构建
pnpm preview      # 本地预览生产构建
```

完成。你现在有一个应用：

- 服务端渲染，带 prefetch 数据
- Hydrate 不再多发请求（SSR 数据通过 `PrefetchedIntents` 复用）
- 客户端路由无刷新
- 已准备好部署到任一支持的 adapter

## 下一步

- [路由与 Controller](./02-routing-and-controllers.md) —— 定义更多路由、控制渲染方式
- [项目结构](./engineering/project-structure.md) —— 应用长大后的推荐布局
