# 2. 路由与 Controller

框架的路由层把 URL 映射到 **intent**，把 intent 映射到 **Controller**，Controller 产出 **Page**。本章覆盖这三个概念。

## 心智模型

```
URL  ──Router.resolve()──▶  RouteMatch { intent, renderMode, guards }
                                │
                                ▼
                       IntentDispatcher.dispatch(intent)
                                │
                                ▼
                         Controller.execute()  →  Page
```

一条路由定义包含：

- **路径模式**（`/products/:id`）
- **intent id**（操作的逻辑名；一个 intent 可以对应多条路由）
- **Controller 实例**（产出页面数据）
- 可选的**渲染模式**（`ssr` / `csr` / `prerender`）
- 可选的**守卫**（`beforeLoad` / `afterLoad`）

## 定义路由

```ts
// src/bootstrap.ts
import { type Framework, defineRoutes } from "@finesoft/front";
import { HomeController } from "./lib/controllers/home";
import { ProductController } from "./lib/controllers/product";
import { authGuard } from "./lib/guards/auth";

export function bootstrap(framework: Framework): void {
    defineRoutes(framework, [
        // 普通 SSR 路由
        { path: "/", intentId: "home", controller: new HomeController() },

        // 动态参数段
        { path: "/products/:id", intentId: "product", controller: new ProductController() },

        // 仅 CSR（服务端只返回空壳）
        {
            path: "/dashboard",
            intentId: "dashboard",
            controller: new DashboardController(),
            renderMode: "csr",
        },

        // 构建期静态化
        {
            path: "/about",
            intentId: "about",
            controller: new AboutController(),
            renderMode: "prerender",
        },

        // 受保护路由 —— 复用 home intent，但加守卫
        {
            path: "/admin",
            intentId: "home",
            controller: new HomeController(),
            beforeLoad: [authGuard],
        },
    ]);
}
```

### 路由选项

| 字段         | 类型                             | 说明                                                           |
| ------------ | -------------------------------- | -------------------------------------------------------------- |
| `path`       | `string`                         | 路径模式，含 `:param` 占位。结尾的 `/` 会被归一化。            |
| `intentId`   | `string`                         | 操作的逻辑名。用于注册 Controller。                            |
| `controller` | `BaseController<TParams, TPage>` | 若 intent 已注册可省略。                                       |
| `renderMode` | `"ssr" \| "csr" \| "prerender"`  | 默认 `"ssr"`。详见[第 4 章](./04-rendering-and-hydration.md)。 |
| `beforeLoad` | `BeforeLoadGuard[]`              | Controller 之前执行。详见[第 3 章](./03-middleware.md)。       |
| `afterLoad`  | `AfterLoadGuard[]`               | Page 产出之后执行。                                            |

### 路径模式

- 静态：`/about`
- 带参数：`/products/:id`、`/users/:userId/posts/:postId`
- 尾部通配：`/files/*`
- **不**支持可选段 —— 写两条路由代替。

参数以字符串键对象的形式传给 `controller.execute(params, container)`。

## 写一个 Controller

```ts
// src/lib/controllers/product.ts
import { BaseController, type Container, type HttpClient } from "@finesoft/front";

interface ProductPage {
    kind: "product";
    id: string;
    name: string;
    price: number;
}

export class ProductController extends BaseController<{ id: string }, ProductPage> {
    readonly intentId = "product";

    async execute(params: { id: string }, container: Container): Promise<ProductPage> {
        const http = container.resolve<HttpClient>("http");
        const product = await http.get<{ name: string; price: number }>(
            `/api/products/${params.id}`,
        );
        return {
            kind: "product",
            id: params.id,
            name: product.name,
            price: product.price,
        };
    }

    fallback(params: { id: string }, _error: unknown): ProductPage {
        return { kind: "product", id: params.id, name: "Not available", price: 0 };
    }
}
```

### Controller 契约

| 成员       | 必需 | 用途                                                                        |
| ---------- | ---- | --------------------------------------------------------------------------- |
| `intentId` | 是   | 必须与路由的 `intentId` 一致（或与 `IntentDispatcher.register` 调用一致）。 |
| `execute`  | 是   | 产出页面。接受解析后的路径参数和请求级 DI 容器。                            |
| `fallback` | 是   | `execute()` 抛错时返回降级页面。必须同步且总能返回。                        |

`BaseController` 把 `execute()` 包在 `try/catch` 里，错误都走 `fallback()`。框架从不让 `dispatch()` 抛错 —— 你的 `fallback()` 是最后一道防线。

### 为什么 `fallback` 是必需的

SSR 期间 `execute()` 抛错本来会让整个请求崩 —— 要么 500，要么渲出空白文档。`fallback()` 让你返回一个结构化的「错误」`Page`，让视图层渲成优雅失败（banner、重试按钮等）。完整模式见 [可观测性 · 错误处理](./08-observability.md#通过-fallback-处理错误)。

## 渲染模式

| 模式          | 服务端返回的内容                 | 适用场景                                    |
| ------------- | -------------------------------- | ------------------------------------------- |
| `"ssr"`       | 完整渲染的 HTML + 序列化数据     | 默认。SEO 和 TTFB 敏感的页面。              |
| `"csr"`       | 空壳 HTML；Controller 在浏览器跑 | 鉴权后的 dashboard、高度个性化的页面。      |
| `"prerender"` | 部署期生成的静态 HTML            | 营销页、文档、博客。结合 ISR（见第 4 章）。 |

模式是**按路由**配置，可以自由混合。框架在构建期重生成 prerendered 路由；SSR 路由每次请求都执行。

## 不绑路由也能注册 Controller

可以为 intent 注册 Controller 但不暴露成路由。这对只通过 `dispatchAction` 触发的 intent 有用：

```ts
framework.intentDispatcher.register("checkout", new CheckoutController());

// 别处：
const page = await framework.intentDispatcher.dispatch({
    intentId: "checkout",
    params: { cartId },
});
```

路由本质上就是按 URL 索引的 intent dispatch。

## 一个 intent 多个路由

同一个 intent 可以服务不同 URL：

```ts
defineRoutes(framework, [
    { path: "/", intentId: "home", controller: new HomeController() },
    { path: "/welcome", intentId: "home" }, // 复用已注册的 HomeController
    { path: "/landing/:slug", intentId: "home" }, // 同 intent，参数不同
]);
```

避免只是 URL 表面不同就复制 Controller 实例。前面例子里 `/admin` 复用 `home` intent 也是同一个套路。

## 检查解析后的 match

诊断或自定义路由时，可以直接调 `Router.resolve()`：

```ts
const match = framework.router.resolve("/products/42");
// {
//   intent: { intentId: "product", params: { id: "42" } },
//   action: { kind: "flow", url: "/products/42" },
//   renderMode: "ssr",
//   guards: { before: [...], after: [...] },
// }
```

未命中返回 `null` —— 在服务端 404 逻辑里处理它。

## 实时演示

下方注册了一个真实的 `Router` 实例（包含示例路由）。在左侧输入 URL，右侧实时显示 `Router.resolve()` 的 `RouteMatch` —— 与框架运行时走的是同一段代码。

<Ch02RouteResolver />

## 下一步

- [中间件](./03-middleware.md) —— 守卫导航、重定向、拒绝
- [渲染与 Hydration](./04-rendering-and-hydration.md) —— Controller 产出 Page 之后发生什么
