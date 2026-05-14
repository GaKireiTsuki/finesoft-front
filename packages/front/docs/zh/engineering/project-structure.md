# 工程实践：项目结构

应用规模超过脚手架起点后的推荐布局。这是 ~20 路由、~10 工程师不大改就能用的形态。

## 布局

```
my-app/
├── src/
│   ├── bootstrap.ts             # 路由 + DI 设置（SSR + CSR 共享）
│   ├── main.ts                  # 浏览器入口
│   ├── ssr.ts                   # SSR 入口
│   ├── App.vue                  # 根组件
│   │
│   ├── routes/                  # 路由定义，按领域分组
│   │   ├── home.ts
│   │   ├── product.ts
│   │   ├── checkout.ts
│   │   └── admin.ts
│   │
│   ├── controllers/             # Controller，每个 intent 一个文件
│   │   ├── home.ts
│   │   ├── product.ts
│   │   └── checkout.ts
│   │
│   ├── views/                   # 视图组件，与 Controller 镜像对应
│   │   ├── Home.vue
│   │   ├── Product.vue
│   │   └── Checkout.vue
│   │
│   ├── lib/
│   │   ├── api/                 # HttpClient 子类
│   │   │   ├── user.ts
│   │   │   └── product.ts
│   │   ├── guards/              # 可复用的中间件
│   │   │   ├── auth.ts
│   │   │   ├── locale.ts
│   │   │   └── analytics.ts
│   │   ├── di/
│   │   │   ├── keys.ts          # APP_KEYS 常量 map
│   │   │   └── register.ts      # 集中注册
│   │   ├── i18n/
│   │   │   └── translator.ts    # Translator 工厂
│   │   └── pages/
│   │       └── types.ts         # Page union 类型
│   │
│   ├── locales/
│   │   ├── en-US.json
│   │   ├── zh-Hans.json
│   │   └── ja-JP.json
│   │
│   └── env.ts                   # 环境变量解析 + 校验
│
├── public/                      # 静态资源，从 / 服务
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig.json
```

## 为什么是这个形状

### `routes/` 与 `controllers/` 分离

路由是**哪里**暴露一个 intent（URL 模式、守卫、渲染模式）。Controller 是 intent **做什么**。拆分让你：

- 跨多个 URL 复用 Controller，路由定义不会污染 Controller 文件
- 读一个目录就知道「应用服务哪些 URL」
- 读一个目录就知道「intent X 计算什么」

### `controllers/` 与 `views/` 镜像

两边每个 intent 一个文件。intent id、Controller 文件、view 文件同名。找 `/products/:id` 的渲染代码变成机械动作。

### 横切关注点都进 `lib/`

不是路由、Controller、view 的都进 `lib/`。框架 `bootstrap()` 通过 `lib/di/register.ts` 做重的注册；Controller 用 `lib/api/*` 里的客户端；守卫住 `lib/guards/`。

### `env.ts` 放在 `src/` 顶层

在一个文件里一次性解析并校验环境变量。用 [zod](https://zod.dev/) 或手写检查。在别处重新导出强类型常量。

```ts
// src/env.ts
function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing env: ${name}`);
    return v;
}

export const env = {
    UPSTREAM_URL: requireEnv("UPSTREAM_URL"),
    SESSION_SECRET: requireEnv("SESSION_SECRET"),
    NODE_ENV: process.env.NODE_ENV ?? "development",
} as const;
```

让「这个应用需要什么环境变量」一目了然，构建时遇到缺失就立刻失败，而不是请求时崩。

## `bootstrap.ts` 的形态

`bootstrap.ts` 保持薄 —— 它该是编排，不是逻辑：

```ts
// src/bootstrap.ts
import { type Framework } from "@finesoft/front";
import { registerDependencies } from "./lib/di/register";
import { homeRoutes } from "./routes/home";
import { productRoutes } from "./routes/product";
import { checkoutRoutes } from "./routes/checkout";
import { adminRoutes } from "./routes/admin";

export function bootstrap(framework: Framework): void {
    registerDependencies(framework.container);

    homeRoutes(framework);
    productRoutes(framework);
    checkoutRoutes(framework);
    adminRoutes(framework);
}
```

每个 `*Routes` 函数用自己的路由调 `defineRoutes(framework, [...])`。加一个新路由组就是一个 import + 一次调用。

## 按领域的路由文件

```ts
// src/routes/product.ts
import { defineRoutes, type Framework } from "@finesoft/front";
import { ProductController } from "../controllers/product";
import { ProductListController } from "../controllers/product-list";
import { authGuard } from "../lib/guards/auth";

export function productRoutes(framework: Framework): void {
    defineRoutes(framework, [
        { path: "/products", intentId: "product-list", controller: new ProductListController() },
        { path: "/products/:id", intentId: "product", controller: new ProductController() },
        {
            path: "/products/:id/edit",
            intentId: "product-edit",
            controller: new ProductEditController(),
            beforeLoad: [authGuard],
            renderMode: "csr",
        },
    ]);
}
```

## 集中式 DI 注册

```ts
// src/lib/di/register.ts
import { type Container, DEP_KEYS } from "@finesoft/front";
import { APP_KEYS } from "./keys";
import { UserApi } from "../api/user";
import { ProductApi } from "../api/product";
import { ConsoleLogger } from "@finesoft/front";
import { env } from "../../env";

export function registerDependencies(container: Container): void {
    container.register(DEP_KEYS.LOGGER, () => new ConsoleLogger("app"));

    container.register(
        APP_KEYS.USER_API,
        () =>
            new UserApi({
                baseUrl: env.UPSTREAM_URL,
            }),
    );
    container.register(
        APP_KEYS.PRODUCT_API,
        () =>
            new ProductApi({
                baseUrl: env.UPSTREAM_URL,
            }),
    );
}
```

集中式让接线可检视。加服务是一次编辑，不是跨项目搜索。

## 强类型 DI key

```ts
// src/lib/di/keys.ts
export const APP_KEYS = {
    USER_API: "userApi",
    PRODUCT_API: "productApi",
    SESSION: "session",
    FEATURE_BUCKETING: "featureBucketing",
} as const;

export type AppKey = (typeof APP_KEYS)[keyof typeof APP_KEYS];
```

然后在任何 Controller 里：

```ts
import { APP_KEYS } from "../lib/di/keys";

async execute(params, container) {
    const api = container.resolve<UserApi>(APP_KEYS.USER_API);
    // ...
}
```

`APP_KEYS.USER_PAI` 这种拼错是编译错误。`"userPai"` 这种拼错是运行时错误。

## Page 类型 union

```ts
// src/lib/pages/types.ts
import type { HomePage } from "../../controllers/home";
import type { ProductPage } from "../../controllers/product";
import type { CheckoutPage } from "../../controllers/checkout";
import type { ErrorPage } from "./error";

export type Page = HomePage | ProductPage | CheckoutPage | ErrorPage;
```

带 `kind` 字段的可辨识 union。视图层根组件按 `page.kind` 分支：

```vue
<script setup lang="ts">
import type { Page } from "@/lib/pages/types";
const props = defineProps<{ page: Page }>();
</script>

<template>
    <Home v-if="page.kind === 'home'" :page="page" />
    <Product v-else-if="page.kind === 'product'" :page="page" />
    <Checkout v-else-if="page.kind === 'checkout'" :page="page" />
    <Error v-else-if="page.kind === 'error'" :page="page" />
</template>
```

discriminant 在每个分支里把类型收窄 —— view 组件拿到完整强类型 `page` prop，不用 cast。

## 拆分 SSR 和浏览器入口

`ssr.ts` 和 `main.ts` 保持薄。两者只在：

- `ssr.ts` 调 `createSSRRender` 并 export `render` + `serializeServerData`
- `main.ts` 调 `startBrowserApp` 挂载视图层

其他一切 —— 路由、Controller、DI、i18n —— 都通过 `bootstrap.ts` 共享。

```ts
// src/ssr.ts
import { createSSRRender, serializeServerData } from "@finesoft/front";
import { renderToString } from "vue/server-renderer";
import { createSSRApp } from "vue";
import App from "./App.vue";
import { bootstrap } from "./bootstrap";

export const render = createSSRRender({
    bootstrap,
    getErrorPage: () => ({ kind: "error", title: "Server error" }),
    async renderApp(page) {
        const html = await renderToString(createSSRApp(App, { page }));
        return { html, head: `<title>${page.title}</title>`, css: "" };
    },
});

export { serializeServerData };
```

```ts
// src/main.ts
import { startBrowserApp } from "@finesoft/front/browser";
import { createSSRApp } from "vue";
import App from "./App.vue";
import { bootstrap } from "./bootstrap";

startBrowserApp({
    bootstrap,
    mount(target, { framework }) {
        createSSRApp(App, { framework }).mount(target);
    },
});
```

## 什么时候打破这个布局

上面的形状能撑到 ~50 路由。过了之后考虑：

- **按特性的文件夹**（`src/features/checkout/{routes,controllers,views,api}.ts`）—— 大型应用。每个特性独立可理解。
- **懒加载路由 bundle**，在路由定义里 `import()`。Vite 插件自动拆分。
- **workspace 包** —— 多应用共享 Controller / API 客户端时。共享代码搬到 `packages/shared`，从那里 import。

不要预先重组。扁平的 `routes/` + `controllers/` 形状到上百文件都没问题。

## 参考

- [工程实践 · 测试](./testing.md) —— 怎么针对这个结构测
- [DI 容器](../07-di-container.md) —— 注册模式
