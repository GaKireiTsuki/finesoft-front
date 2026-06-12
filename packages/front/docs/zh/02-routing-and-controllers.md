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
- 可选的**参数 codec**（`params` / `query`）—— 校验并类型化 URL 参数
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
| `params`     | codec map                        | 校验/转换 **path** 参数。key 必须出现在 `path` 中。见下文。    |
| `query`      | codec map                        | 校验/转换 **query** 参数。key 开放。见下文。                   |
| `renderMode` | `"ssr" \| "csr" \| "prerender"`  | 默认 `"ssr"`。详见[第 4 章](./04-rendering-and-hydration.md)。 |
| `beforeLoad` | `BeforeLoadGuard[]`              | Controller 之前执行。详见[第 3 章](./03-middleware.md)。       |
| `afterLoad`  | `AfterLoadGuard[]`               | Page 产出之后执行。                                            |

### 路径模式

- 静态：`/about`
- 带参数：`/products/:id`、`/users/:userId/posts/:postId`
- 可选参数：`/blog/:slug?` 同时匹配 `/blog` 和 `/blog/hello`。

默认情况下，path 和 query 参数以**字符串键对象**的形式进入 `controller.execute(params, container)`。挂上 codec（下一节）即可校验并转换它们。

## 路由参数类型化

codec 把原始字符串参数变成经校验、已转换、**编译期类型化**的值。内置原语零依赖覆盖常见场景；任意 [Standard Schema](https://standardschema.dev)（zod、valibot、arktype……）也能用。

```ts
import { defineRoutes, int, list, oneOf, optional, str, withDefault } from "@finesoft/front";

defineRoutes(framework, [
    {
        path: "/products/:id",
        intentId: "product",
        controller: new ProductController(),
        params: { id: int({ min: 1 }) }, // :id 校验为正整数，转换为 number
        query: {
            page: withDefault(int({ min: 1 }), 1), // ?page= → number，缺失时默认 1
            sort: optional(oneOf(["asc", "desc"] as const)), // 可选的 "asc" | "desc"
            tags: list(str()), // ?tags=a&tags=b → string[]
        },
    },
]);
```

### 内置 codec

| codec                   | 输出       | 校验                                              |
| ----------------------- | ---------- | ------------------------------------------------- |
| `str(opts?)`            | `string`   | `minLength` / `maxLength` / `pattern`（`RegExp`） |
| `int(opts?)`            | `number`   | 整数 + `min` / `max`                              |
| `num(opts?)`            | `number`   | 有限数 + `min` / `max`                            |
| `bool()`                | `boolean`  | `"true" \| "1" \| "false" \| "0"`                 |
| `oneOf([...] as const)` | 字面量联合 | 成员检查                                          |
| `uuid()`                | `string`   | UUID v1–v5                                        |
| `list(item, opts?)`     | `T[]`      | 多值 query；每项过 `item` + `min`/`max` 个数      |

修饰器包裹 codec（codec 保持可序列化纯数据，不用链式 `.optional()`）：

- `optional(codec)` —— 输入缺失 → `undefined`；把该 key 渲染为**可选属性**（`page?: T`）。
- `withDefault(codec, fallback)` —— 输入缺失 → `fallback`；key 保持必选。

### 校验失败 = fall-through 到 404

codec 校验失败意味着该路由**不匹配** —— 路由器继续尝试下一条，全不中时落到既有 404。**没有**单独的 `400` 通道。这让重叠路由可以按类型消歧：

```ts
defineRoutes(framework, [
    { path: "/item/:id", intentId: "item-by-id", controller, params: { id: int() } },
    { path: "/item/:slug", intentId: "item-by-slug", controller, params: { slug: str() } },
]);
// /item/42    → item-by-id   （int 匹配）
// /item/hello → item-by-slug （int 拒绝 → fall-through 到 str）
```

### 编译期参数类型

`InferParams` / `InferQuery` 直接从 codec 对象推导 Controller 的参数类型 —— 无需手写、也不必和路由保持同步：

```ts
import {
    BaseController,
    type InferParams,
    type InferQuery,
    int,
    oneOf,
    optional,
} from "@finesoft/front";

const params = { id: int() };
const query = { sort: optional(oneOf(["asc", "desc"] as const)) };

class ProductController extends BaseController<
    InferParams<typeof params> & InferQuery<typeof query>, // { id: number; sort?: "asc" | "desc" }
    ProductPage
> {
    readonly intentId = "product";
    execute(params) {
        // params.id: number, params.sort: "asc" | "desc" | undefined
    }
}
```

### `route()` —— 参数 key 安全

数组对象形态本身已会检查 `params` 的每个 key 都出现在 `path` 中。`route(path, def)` helper 把同样的检查做成独立、可组合的条目：

```ts
route("/products/:id", { intentId: "product", params: { id: int() } }); // ✓
route("/products/:id", { intentId: "product", params: { slug: str() } }); // ✗ 编译报错："slug" 不在 path 中
```

### `defineRoute()` —— 自动类型化的 handler

`defineRoute(path, def)` 接受一个 **handler** 函数而非 Controller 类，并从 codec 自动推导其入参类型 —— 无需 `InferParams`。它复刻 `BaseController` 的 `try/catch → fallback`：

```ts
defineRoute("/products/:id", {
    intentId: "product",
    params: { id: int() },
    query: { page: withDefault(int(), 1) },
    handler: (params, container) => {
        // params: { id: number; page: number } —— 从 codec 推导
        return loadProduct(params.id, params.page);
    },
    fallback: (params, error) => errorPage(error), // 可选
});
```

没有 `params` / `query` 的路由行为完全不变 —— 参数保持字符串，运行时无变化。

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

诊断或自定义路由时，可以直接调 `Router.resolve()`。它是**异步**的（codec 可能异步校验），需 `await`：

```ts
const match = await framework.router.resolve("/products/42");
// {
//   intent: { id: "product", params: { id: "42" } },
//   action: { kind: "flow", url: "/products/42" },
//   renderMode: "ssr",
//   beforeGuards: [...],
//   afterGuards: [...],
// }
```

未命中时 resolve 出 `null` —— 在服务端 404 逻辑里处理它。

## 实时演示

下方注册了一个真实的 `Router` 实例（包含示例路由）。在左侧输入 URL，右侧实时显示 `Router.resolve()` 的 `RouteMatch` —— 与框架运行时走的是同一段代码。

<Ch02RouteResolver />

## 下一步

- [中间件](./03-middleware.md) —— 守卫导航、重定向、拒绝
- [渲染与 Hydration](./04-rendering-and-hydration.md) —— Controller 产出 Page 之后发生什么
