# @finesoft/front

`@finesoft/front` 是一个面向 SSR Web 应用的聚合包，统一导出了以下四层能力：

- `@finesoft/core`：路由、Intent、Controller、依赖注入、Framework
- `@finesoft/browser`：浏览器启动、导航、hydrate、prefetched data
- `@finesoft/ssr`：SSR 渲染与服务端数据注入
- `@finesoft/server`：Hono 服务端集成、Vite 插件、声明式代理、渲染模式覆盖、部署适配器

它适合这样一类应用：

$$
URL \rightarrow Router \rightarrow Intent \rightarrow Controller \rightarrow Page\ Model \rightarrow SSR / Hydration
$$

也就是说：URL 决定页面语义，Controller 负责取数和组装页面模型，UI 层只负责渲染页面模型。

---

## 适用场景

`@finesoft/front` 更适合以下类型的项目：

- 需要 SSR 的内容型站点
- 有明确 URL 语义的多页面 Web 应用
- 希望将页面获取逻辑集中在 Controller 中的项目
- 需要同一套页面模型同时服务 SSR 和客户端导航的项目

例如：

- 内容聚合站点
- 应用商店、媒体展示、排行榜、搜索、详情页
- 需要 SEO 的展示型前端

如果你的项目非常轻量、完全不需要 SSR，也可以只使用其中的 Browser/Core 能力。

---

## 主要导出

### Core

- `Framework`
- `Router`
- `Container`
- `BaseController`
- `defineRoutes`
- `ActionDispatcher`
- `IntentDispatcher`
- `HttpClient`
- `LruMap`
- `buildUrl`
- `next` / `redirect` / `rewrite` / `deny`
- `createBrowserContext` / `createServerContext`
- `BeforeLoadGuard` / `AfterLoadGuard`

### Browser

- `startBrowserApp`
- `History`
- `registerActionHandlers`
- `registerFlowActionHandler`
- `registerExternalUrlHandler`
- `deserializeServerData`
- `createPrefetchedIntentsFromDom`
- `tryScroll`

### SSR

- `createSSRRender`
- `ssrRender`
- `injectSSRContent`
- `serializeServerData`
- `SSR_PLACEHOLDERS`

### Server / Deployment

- `createServer`
- `createSSRApp`
- `startServer`
- `parseAcceptLanguage`
- `detectRuntime`
- `resolveRoot`
- `finesoftFrontViteConfig`
- `registerProxyRoutes`
- `ProxyRouteConfig`
- `nodeAdapter`
- `vercelAdapter`
- `cloudflareAdapter`
- `netlifyAdapter`
- `staticAdapter`
- `autoAdapter`
- `resolveAdapter`

---

## 选择哪种接入方式

### 方式 A：使用 `finesoftFrontViteConfig()`

这是推荐方式，适合大多数项目。

优点：

- `vite` 可直接用于开发
- `vite build` 会同时完成客户端与 SSR 构建
- 可以直接接入平台适配器输出部署产物
- `vite preview` 可用于本地预览 SSR 构建结果
- 可通过 `renderModes` 统一覆盖路由的 `ssr` / `csr` / `prerender` 策略
- 可通过 `proxies` 声明式配置代理路由，避免在 `setup` 中手写转发逻辑
- 开发模式会尽量把入口依赖的全局 CSS 提前注入到 SSR HTML，减少首屏布局抖动

### 方式 B：手动使用 `createServer()`

适合以下情况：

- 你需要完全控制服务启动流程
- 你已经有自定义的 Hono / Node 集成方式
- 你不希望依赖 Vite 插件生命周期

### 方式 C：仅使用 Browser/Core

适合以下情况：

- 你不需要 SSR
- 你只希望复用 Router / Intent / Controller / Framework 模型

---

## 安装

### 仅浏览器端使用

```bash
pnpm add @finesoft/front
```

### SSR / Vite / Adapter 使用

```bash
pnpm add @finesoft/front hono @hono/node-server vite
```

### 如果你希望 `createServer()` 自动加载 `.env`

```bash
pnpm add dotenv
```

### 当前 peer dependencies

- `hono`
- `@hono/node-server`
- `vite`

如果你只使用浏览器侧能力，不一定需要全部安装；如果你使用 SSR、Server 或 Vite 插件，则建议全部安装。

---

## 入口行为说明

`@finesoft/front` 提供了 `browser` export condition。

这意味着：

- 浏览器构建时，会优先解析 browser-only entry，避免引入服务端实现
- Node / SSR 环境下，会解析完整入口，包含 Browser、SSR、Server 全部导出

因此大多数情况下你可以直接这样写：

```ts
import { startBrowserApp } from "@finesoft/front";
```

现代 bundler 会根据环境自动选择更合适的入口。

---

## 推荐工作流：Vite + SSR + Hydration

下面是一套面向公共用户的最小接入流程。

### 1. 准备目录结构

建议至少包含以下文件：

```text
src/
  browser.ts
  ssr.ts
  lib/
    bootstrap.ts
    models/
      page.ts
    controllers/
      home-controller.ts
index.html
vite.config.ts
```

如果你需要注册额外 Hono 路由，可以增加：

```text
src/setup.ts
```

如果只是配置 API 代理，优先使用 `vite.config.ts` / `createServer()` 中的 `proxies`，通常不再需要单独写 `src/setup.ts`。

---

### 2. 编写 `index.html`

你的 HTML 模板必须包含以下 SSR 占位符：

```html
<!DOCTYPE html>
<html lang="<!--ssr-lang-->">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <!--ssr-head-->
    </head>
    <body>
        <div id="app"><!--ssr-body--></div>
        <!--ssr-data-->
        <script type="module" src="/src/browser.ts"></script>
    </body>
</html>
```

| 占位符            | 用途                    |
| ----------------- | ----------------------- |
| `<!--ssr-lang-->` | 当前语言                |
| `<!--ssr-head-->` | SSR `<head>` 内容与样式 |
| `<!--ssr-body-->` | 服务端渲染后的 HTML     |
| `<!--ssr-data-->` | 序列化后的服务端数据    |

---

### 3. 编写路由与 Controller 注册

推荐使用 `defineRoutes()`，把 URL 与 Controller 声明放在同一处。

`src/lib/bootstrap.ts`：

```ts
import {
    BasePage,
    BaseController,
    Container,
    Framework,
    defineRoutes,
    type RouteDefinition,
} from "@finesoft/front";

class HomeController extends BaseController<Record<string, string>, BasePage> {
    readonly intentId = "home-page";

    async execute(_params: Record<string, string>, _container: Container) {
        return {
            id: "page-home",
            pageType: "home",
            title: "Home",
            description: "A page rendered by @finesoft/front",
        };
    }
}

const routes: RouteDefinition[] = [
    { path: "/", intentId: "home-page", controller: new HomeController() },
];

export function bootstrap(framework: Framework): void {
    defineRoutes(framework, routes);
}

// 如果你计划使用 static adapter，建议导出 routes
export { routes };
```

### 3.1 可选：注册导航守卫

框架提供两阶段守卫：

- `beforeLoad`：路由匹配后、数据加载前执行。适合认证、权限校验、提前重定向。
- `afterLoad`：数据加载后、渲染前执行。适合基于页面数据做 URL 规范化、二次校验。**这个阶段可以直接拿到 `ctx.page`。**

既支持**全局守卫**，也支持**路由级守卫**。

```ts
import {
    Framework,
    defineRoutes,
    next,
    redirect,
    rewrite,
    type AfterLoadGuard,
    type BeforeLoadGuard,
    type RouteDefinition,
} from "@finesoft/front";

const requireLogin: BeforeLoadGuard = (ctx) => {
    if (!ctx.getCookie("session")) {
        return redirect("/login");
    }
    return next();
};

const canonicalizeProductUrl: AfterLoadGuard = (ctx) => {
    const slug = ctx.page.title.toLowerCase().replace(/\s+/g, "-");
    const expected = `/product/${slug}/${ctx.page.id}`;

    return ctx.path === expected ? next() : rewrite(expected);
};

const routes: RouteDefinition[] = [
    {
        path: "/account",
        intentId: "account-page",
        controller: new AccountController(),
        beforeLoad: [requireLogin],
    },
    {
        path: "/product/:id",
        intentId: "product-page",
        controller: new ProductController(),
        afterLoad: [canonicalizeProductUrl],
    },
];

export function bootstrap(framework: Framework): void {
    framework.beforeLoad((ctx) => {
        console.log("global beforeLoad:", ctx.path);
        return next();
    });

    framework.afterLoad((ctx) => {
        console.log("global afterLoad page:", ctx.page.pageType);
        return next();
    });

    defineRoutes(framework, routes);
}
```

执行顺序为：**全局守卫 → 路由级守卫**。按注册顺序依次执行，遇到第一个非 `next()` 结果会立即短路。

#### 为什么 `static` 模式建议导出 `routes`

`staticAdapter()` 会在构建期读取你的路由定义，并自动预渲染无参数路由。

如果没有导出 `routes`，静态导出时将无法自动发现这些页面。

---

### 4. 编写浏览器入口 `src/browser.ts`

```ts
import { startBrowserApp } from "@finesoft/front";
import { bootstrap } from "./lib/bootstrap";

startBrowserApp({
    bootstrap,
    defaultLocale: "en",
    mountId: "app",
    mount: (target, { framework, locale }) => {
        // 在这里接入你的 UI 框架（Svelte / React / Vue）
        return ({ page, isFirstPage }) => {
            void target;
            void framework;
            void locale;
            void page;
            void isFirstPage;
        };
    },
    callbacks: {
        onNavigate(pathname) {
            console.log("navigate:", pathname);
        },
        onModal(page) {
            console.log("modal:", page);
        },
    },
});
```

---

### 5. 编写 SSR 入口 `src/ssr.ts`

```ts
import { createSSRRender, serializeServerData } from "@finesoft/front";
import { bootstrap } from "./lib/bootstrap";

export const render = createSSRRender({
    bootstrap,
    getErrorPage(status, message) {
        return {
            id: `error-${status}`,
            pageType: "error",
            title: message,
            statusCode: status,
        };
    },
    renderApp(page, locale) {
        void page;
        void locale;
        return {
            html: "",
            head: "",
            css: "",
        };
    },
});

export { serializeServerData };
```

`createSSRRender()` 最终会生成一个 `render(url, locale)` 函数，其返回值与服务端 SSR 模块契约一致。

---

### 6. 如果你有自定义 Hono 路由（非代理类），编写 `src/setup.ts`

```ts
import type { Hono } from "hono";

export default function setup(app: Hono) {
    app.get("/api/health", (c) => c.json({ ok: true }));
}
```

建议优先导出 `default` 函数。

`setup` 更适合放健康检查、业务回调、实验性接口等自定义路由。

如果你的需求是“把 `/api/foo/*` 转发到某个 HTTPS 上游”，请优先使用 `proxies` 选项，让框架统一处理路径校验、认证头、缓存头和错误响应。

`setup` 在插件中有两种用法：

- 传入函数：适用于 `dev` / `preview`
- 传入文件路径字符串：适用于 `dev` / `build` / `preview` / adapter

如果你需要让构建产物也包含这些路由，建议传入文件路径字符串。

---

### 7. 配置 `vite.config.ts`

```ts
import { finesoftFrontViteConfig } from "@finesoft/front";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [
        finesoftFrontViteConfig({
            locales: ["zh", "en"],
            defaultLocale: "en",
            ssr: { entry: "src/ssr.ts" },
            renderModes: {
                "/search": "csr",
                "/stories/*": "prerender",
            },
            proxies: [
                {
                    prefix: "/api/itunes",
                    target: "https://itunes.apple.com",
                    cache: "public, max-age=300, s-maxage=600",
                    followRedirects: true,
                },
            ],
            setup: "src/setup.ts",
            adapter: "node",
        }),
    ],
});
```

当前支持的 adapter：

- `"node"`
- `"vercel"`
- `"cloudflare"`
- `"netlify"`
- `"static"`
- `"auto"`
- 或自定义 `Adapter` 对象

### `renderModes` 与 `proxies` 的推荐用法

#### `renderModes`

`renderModes` 用于在 Vite 插件层按 URL 覆盖渲染模式，优先级高于路由定义里的 `renderMode`。

支持两种 key：

- 精确路径：如 `"/search"`
- glob 模式：如 `"/stories/*"`

可用值：

- `"ssr"`
- `"csr"`
- `"prerender"`

当你需要“页面逻辑不变，但按部署 / 产品策略切换渲染方式”时，优先改这里，而不是到各个路由定义里逐个改。

#### `proxies`

`proxies` 用于声明式注册代理路由，适合 Apple API、RSS、上游聚合接口这类“路径前缀固定、目标域名固定”的转发场景。

每一项支持这些关键字段：

- `prefix`：本地路由前缀，如 `"/api/itunes"`
- `target`：上游 HTTPS 地址
- `methods`：允许的方法列表，默认 `["all"]`
- `headers`：附加请求头
- `auth`：从环境变量读取 Bearer / Basic 认证
- `cache`：统一设置 `Cache-Control`
- `followRedirects`：是否跟随 3xx

相比在 `setup` 中手写 Hono 代理，`proxies` 的好处是：

- 框架统一做 SSRF 基础防护
- dev / preview / adapter 构建产物行为一致
- 代理逻辑更容易复用和审查

---

### 8. 配置脚本

```json
{
    "scripts": {
        "dev": "vite",
        "build": "vite build",
        "preview": "vite preview"
    }
}
```

---

### 9. 启动与构建

开发：

```bash
pnpm dev
```

构建：

```bash
pnpm build
```

本地预览：

```bash
pnpm preview
```

---

## 完整 Svelte 示例

下面是一套不依赖任何仓库内约定、可以独立理解的 Svelte 示例。

### `src/lib/models/page.ts`

```ts
import type { BasePage } from "@finesoft/front";

export interface HomePage extends BasePage {
    pageType: "home";
    body: string;
}

export interface ErrorPage extends BasePage {
    pageType: "error";
    errorMessage: string;
    statusCode: number;
}

export type Page = HomePage | ErrorPage;
```

### `src/lib/bootstrap.ts`

```ts
import {
    BaseController,
    Container,
    Framework,
    defineRoutes,
    type RouteDefinition,
} from "@finesoft/front";
import type { ErrorPage, HomePage, Page } from "./models/page";

class HomeController extends BaseController<Record<string, string>, Page> {
    readonly intentId = "home-page";

    async execute(_params: Record<string, string>, _container: Container): Promise<HomePage> {
        return {
            id: "page-home",
            pageType: "home",
            title: "Hello Svelte + Finesoft Front",
            description: "A minimal SSR page rendered by Svelte",
            body: "This page is rendered on the server first and hydrated on the client.",
        };
    }

    override fallback(_params: Record<string, string>, error: Error): ErrorPage {
        return {
            id: "page-error",
            pageType: "error",
            title: "Error",
            errorMessage: error.message,
            statusCode: 500,
        };
    }
}

const routes: RouteDefinition[] = [
    { path: "/", intentId: "home-page", controller: new HomeController() },
];

export function bootstrap(framework: Framework): void {
    defineRoutes(framework, routes);
}

export { routes };
```

### `src/browser.ts`

```ts
import { startBrowserApp } from "@finesoft/front";
import App from "./App.svelte";
import { bootstrap } from "./lib/bootstrap";
import type { Page } from "./lib/models/page";

startBrowserApp({
    bootstrap,
    defaultLocale: "en",
    mount: (target, { framework, locale }) => {
        const app = new App({
            target,
            hydrate: true,
            props: {
                locale,
                framework,
            },
        });

        return (props) => {
            app.$set(
                props as {
                    page: Promise<Page> | Page;
                    isFirstPage?: boolean;
                },
            );
        };
    },
    callbacks: {
        onNavigate(pathname) {
            console.log("navigate:", pathname);
        },
        onModal(page) {
            console.log("modal:", page);
        },
    },
});
```

### `src/ssr.ts`

```ts
import { createSSRRender, serializeServerData } from "@finesoft/front";
import App from "./App.svelte";
import { bootstrap } from "./lib/bootstrap";
import type { ErrorPage, Page } from "./lib/models/page";

export { serializeServerData };

function getErrorPage(status: number, message: string): ErrorPage {
    return {
        id: `page-error-${status}`,
        pageType: "error",
        title: "Error",
        errorMessage: message,
        statusCode: status,
    };
}

export const render = createSSRRender({
    bootstrap,
    getErrorPage,
    renderApp(page, locale) {
        const result = (App as any).render({
            page: page as Page,
            isFirstPage: true,
            locale,
        });

        return {
            html: result.html ?? "",
            head: result.head ?? "",
            css: result.css?.code ?? "",
        };
    },
});
```

### `src/App.svelte`

```svelte
<script lang="ts">
	import type { Framework } from "@finesoft/front";
	import type { ErrorPage, Page } from "./lib/models/page";

	export let page: Promise<Page> | Page = new Promise(() => {});
	export let isFirstPage = true;
	export let locale = "en";
	export let framework: Framework | undefined = undefined;

	$: safePage = normalizePage(page);

	function normalizePage(value: Promise<Page> | Page): Promise<Page> | Page {
		if (!(value instanceof Promise)) return value;

		return value.catch(
			(err): ErrorPage => ({
				id: "page-error-runtime",
				pageType: "error",
				title: "Error",
				errorMessage:
					err instanceof Error ? err.message : "Failed to load page",
				statusCode: 500,
			}),
		);
	}

	function getMessage(resolved: Page): string {
		return resolved.pageType === "home"
			? resolved.body
			: resolved.errorMessage;
	}
</script>

<svelte:head>
	<title>Finesoft Front Svelte Example</title>
	<meta
		name="description"
		content="Minimal Svelte SSR example powered by @finesoft/front"
	/>
</svelte:head>

{#await safePage}
	<main>
		<h1>Loading...</h1>
		<p>{isFirstPage ? "Preparing first page" : "Navigating"}</p>
	</main>
{:then resolved}
	<main>
		<p>locale: {locale}</p>
		<h1>{resolved.title}</h1>
		<p>{getMessage(resolved)}</p>

		<nav>
			<a href="/">Home</a>
		</nav>

		{#if framework}
			<p>Framework is available on the client and can be passed to child components.</p>
		{/if}
	</main>
{/await}
```

### 这个 Svelte 示例的关键点

1. `browser.ts` 中使用 `hydrate: true`，让客户端接管 SSR HTML。
2. `ssr.ts` 中使用 `App.render(...)`，并将 `{ html, head, css }` 返回给 `createSSRRender()`。
3. `App.svelte` 的 `page` 同时支持 `Page` 与 `Promise<Page>`，兼容首屏渲染与客户端导航。
4. 对 rejected promise 做兜底转换，可以将运行时错误转成可控的错误页面。
5. 如果你希望子组件直接访问 `Framework`，可以再封装一层 Svelte context 工具。

---

## Adapter 输出说明

### `adapter: "node"`

输出：

- `dist/server/index.mjs`

运行方式：

```bash
node dist/server/index.mjs
```

适合：

- Node 服务器
- Docker
- VPS
- PM2

---

### `adapter: "vercel"`

输出：

- `.vercel/output/config.json`
- `.vercel/output/static/`
- `.vercel/output/functions/ssr.func/`

说明：

- 它不在 `dist/` 中，这是平台约定
- 对应 Vercel Build Output API v3

建议将 `.vercel/` 加入 `.gitignore`。

---

### `adapter: "netlify"`

输出：

- `.netlify/functions-internal/ssr/index.mjs`
- `dist/client/_redirects`

说明：

- `.netlify/` 在 `dist/` 外同样属于平台约定
- 常见发布目录是 `dist/client/`

建议将 `.netlify/` 加入 `.gitignore`。

---

### `adapter: "cloudflare"`

输出：

- `dist/cloudflare/_worker.js`
- `dist/cloudflare/assets/`

说明：

- Cloudflare Workers 不是完整 Node.js 环境
- 如果运行时代码依赖 Node API，可能需要额外兼容配置

---

### `adapter: "static"`

输出：

- `dist/static/`

适合：

- 纯静态托管
- CDN / 对象存储 / Pages 类平台
- 不依赖运行时服务端逻辑的页面

它会执行：

1. 读取导出的路由配置
2. 自动预渲染无参数路由
3. 复制客户端静态资源
4. 输出纯 HTML / CSS / JS 文件

#### `static` 模式的三个注意点

##### 1）只会自动预渲染无参数路由

例如这些通常会自动生成：

- `/`
- `/search`
- `/about`

这些通常不会自动生成：

- `/product/:id`
- `/list/:category`

如果你要预渲染动态地址，请补充具体 URL：

```ts
import { staticAdapter } from "@finesoft/front";

finesoftFrontViteConfig({
    adapter: staticAdapter({
        dynamicRoutes: ["/product/123", "/list/games"],
    }),
});
```

##### 2）构建时必须能够拿到页面数据

`static` 预渲染会在构建期执行 Controller。

如果 Controller 依赖外部 API，而构建时这些 API 不可访问，页面可能构建失败或退化为错误页。

常见解决方式：

- 构建期确保 API 可访问
- 为 Controller 提供 fallback / mock 数据

##### 3）验证静态产物时，应直接查看 `dist/static/`

如果你要验证静态导出的最终结果，可以直接服务这个目录：

```bash
cd dist/static
python3 -m http.server 3000
```

---

### `adapter: "auto"`

自动识别顺序：

- `VERCEL` → `vercel`
- `CF_PAGES` → `cloudflare`
- `NETLIFY` → `netlify`
- 默认 → `node`

适合 CI 或平台自动识别场景。

---

## 自定义 Adapter

你也可以直接传入自定义 `Adapter` 对象：

```ts
import type { Adapter } from "@finesoft/front";

const customAdapter: Adapter = {
    name: "my-platform",
    async build(ctx) {
        // ctx 中包含 root / vite / fs / path / templateHtml
        // 以及 generateSSREntry / buildBundle / copyStaticAssets 等工具方法
    },
};
```

使用方式：

```ts
finesoftFrontViteConfig({
    adapter: customAdapter,
});
```

---

## 手动模式：`createServer()`

如果你不希望通过 Vite 插件接入，也可以直接使用 `createServer()`。

```ts
import { createServer } from "@finesoft/front";

const { app, vite, runtime } = await createServer({
    root: process.cwd(),
    locales: ["zh", "en"],
    defaultLocale: "en",
    port: 3000,
    proxies: [
        {
            prefix: "/api/itunes",
            target: "https://itunes.apple.com",
            followRedirects: true,
        },
    ],
    setup(app) {
        app.get("/api/health", (c) => c.json({ ok: true }));
    },
    ssr: {
        ssrEntryPath: "/src/ssr.ts",
    },
});

void app;
void vite;
void runtime;
```

### `createServer()` 会处理的内容

1. 解析项目根目录
2. 如果存在 `.env`，尝试自动加载
3. 检测当前运行时
4. 在开发模式下创建 Vite middleware server
5. 创建 Hono app
6. 先注册声明式代理路由，再注册自定义业务路由
7. 再挂载 SSR catch-all
8. 启动服务

默认行为：

- `root` 默认值：`process.cwd()`
- `port` 默认值：`process.env.PORT ?? 3000`
- 根目录存在 `.env` 且安装了 `dotenv` 时，会尝试自动加载

---

## 纯浏览器模式

如果你只需要 Router / Intent / Controller / Framework，也可以单独使用浏览器侧能力。

```ts
import { Framework, defineRoutes, startBrowserApp } from "@finesoft/front";

function bootstrap(framework: Framework) {
    defineRoutes(framework, [{ path: "/", intentId: "home", controller: new HomeController() }]);
}

startBrowserApp({
    bootstrap,
    mount: (target) => {
        return ({ page }) => {
            void target;
            void page;
        };
    },
    callbacks: {
        onNavigate() {},
        onModal() {},
    },
});
```

---

## 常见问题

### 1. `index.html` 少了 SSR 占位符

现象：

- 页面未正常 hydrate
- SSR 内容缺失
- 服务端数据未注入

请检查以下四个占位符是否全部存在：

- `<!--ssr-lang-->`
- `<!--ssr-head-->`
- `<!--ssr-body-->`
- `<!--ssr-data-->`

---

### 2. `setup` 传了函数，但构建产物中没有生效

原因：

- 直接传函数主要适用于 `dev` / `preview`
- 构建期更适合通过文件路径构建 `setup` 模块

建议：

- 使用文件路径字符串，例如 `setup: "src/setup.ts"`

### 3. 什么时候该用 `proxies`，什么时候该用 `setup`

一般可以这样判断：

- **固定前缀 → 固定 HTTPS 上游**：用 `proxies`
- **自定义 JSON 接口 / webhook / health check / 特殊中间件**：用 `setup`

如果你在 `setup` 里主要写的是“拼接目标 URL 再 `fetch` 转发”，那大概率更适合迁移到 `proxies`。

---

### 4. `static` 模式下动态路由没有页面

原因：

- `staticAdapter()` 只会自动预渲染无参数路由

解决方式：

- 使用 `dynamicRoutes` 提供具体 URL

---

### 5. `static` 模式构建出来的是错误页

原因通常是：

- 构建期 Controller 访问外部 API 失败
- 但 fallback 没有提供可用的本地数据

解决方式：

- 保证构建期 API 可访问，或
- 给 Controller 提供 fallback / mock 数据

---

### 6. `.vercel/` 和 `.netlify/` 为什么不在 `dist/`

这是平台约定，不是框架异常：

- Vercel 使用 `.vercel/output/`
- Netlify 使用 `.netlify/functions-internal/`

建议将这些目录加入 `.gitignore`。

---

## License

MIT
