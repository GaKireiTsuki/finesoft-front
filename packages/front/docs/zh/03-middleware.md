# 3. 中间件

中间件分两个阶段，包在 Controller 周围。守卫检查导航后返回四种结果之一，决定下一步发生什么。

## 管线

```
Router.resolve()
     │
     ▼
  beforeLoad 链        ← NavigationContext（此时还没有 Page）
     │
   next()? ──否──▶ 短路（redirect / rewrite / deny）
     │ 是
     ▼
IntentDispatcher.dispatch()
     │
     ▼
  afterLoad 链         ← PostLoadContext（已有 Page）
     │
   next()? ──否──▶ 短路
     │ 是
     ▼
   render
```

守卫按数组顺序执行。第一个非 `next()` 的结果短路后续链。

## 四种结果

```ts
import { next, redirect, rewrite, deny } from "@finesoft/front";

next(); // 继续下一个守卫 / dispatcher
redirect("/login"); // HTTP 302；导航到 URL
redirect("/old", 301); // HTTP 301（永久）
rewrite("/canonical"); // beforeLoad 里：内部重路由；afterLoad 里：canonical 信号
deny(); // 403 Forbidden
deny(404, "Not found"); // 自定义状态码 + 消息
```

### `next()`

直通。管线继续。

### `redirect(url, status?)`

浏览器导航到 `url`，原始渲染被丢弃。服务端表现为 HTTP 重定向；浏览器表现为导航（通过 `History.pushState`）。

适用：登录跳转、废弃路径、locale 前缀归一化。

### `rewrite(url)`

**`beforeLoad` 里的 rewrite** —— 内部重路由。Router 改为解析 `url`，_新_ match 的守卫和 Controller 跑。不产生 HTTP 重定向；地址栏保持原 URL。深度限制为 5 层，防死循环。

**`afterLoad` 里的 rewrite** —— canonical 信号。框架在 SSR 响应里包含 `Content-Location` 头，但不重定向。浏览器收到原 URL 加一个提示：存在 canonical 版本。

何时用哪个，见 [redirect vs rewrite](./pitfalls/redirect-vs-rewrite.md)。

### `deny(status?, message?)`

停止请求。默认 `403 Forbidden`。常见：`deny(401, "Login required")`、`deny(404, "Not found")`。

## 写守卫

守卫是从 context 到 `MiddlewareResult`（或 `Promise<MiddlewareResult>`）的函数。

```ts
// src/lib/guards/auth.ts
import { next, redirect, type NavigationContext } from "@finesoft/front";

export function authGuard(ctx: NavigationContext) {
    const token = ctx.getCookie("token");
    if (!token) {
        return redirect(`/login?next=${encodeURIComponent(ctx.url.pathname)}`);
    }
    return next();
}
```

### `NavigationContext`（beforeLoad）

| 字段              | 类型                               | 说明                                    |
| ----------------- | ---------------------------------- | --------------------------------------- |
| `url`             | `URL`                              | 完整请求 URL。                          |
| `intent`          | `Intent`                           | 解析后的 intent，包含路径参数。         |
| `container`       | `Container`                        | 请求级 DI 容器。                        |
| `getCookie(name)` | `(name: string) => string \| null` | 读 cookie（服务端 + 浏览器都可用）。    |
| `getHeader(name)` | `(name: string) => string \| null` | 读请求头（仅服务端；浏览器返回 null）。 |
| `isSsr`           | `boolean`                          | 服务端 `true`，浏览器 `false`。         |

### `PostLoadContext`（afterLoad）

继承自 `NavigationContext`，新增：

| 字段   | 类型       | 说明                     |
| ------ | ---------- | ------------------------ |
| `page` | `BasePage` | Controller 产出的 Page。 |

## 给路由挂守卫

```ts
defineRoutes(framework, [
    {
        path: "/admin",
        intentId: "admin",
        controller: new AdminController(),
        beforeLoad: [authGuard, requireAdminRole],
        afterLoad: [trackPageView],
    },
]);
```

路由上的守卫**叠加**在框架全局守卫之上（见下）。顺序：先全局，后路由级。

## 全局守卫

注册对每个导航都生效的守卫：

```ts
framework.middleware.use("beforeLoad", trackingGuard);
framework.middleware.use("afterLoad", metricsGuard);
```

慎用。全局守卫每页都跑，包括 SSR —— 慢的全局守卫会乘到整个表面积上。

## 常见模式

### 鉴权

```ts
function authGuard(ctx: NavigationContext) {
    const token = ctx.getCookie("session");
    if (!token) return redirect("/login?next=" + encodeURIComponent(ctx.url.pathname));
    return next();
}
```

### 角色校验

```ts
async function requireAdmin(ctx: NavigationContext) {
    const session = await ctx.container.resolve<SessionService>("session").current();
    if (!session?.isAdmin) return deny(403, "Admin only");
    return next();
}
```

### Locale 前缀重定向

```ts
function localePrefixGuard(ctx: NavigationContext) {
    if (/^\/(en|zh|ja)\//.test(ctx.url.pathname)) return next();
    const detected = detectLocale(ctx); // 你自己的逻辑
    return redirect(`/${detected}${ctx.url.pathname}`, 301);
}
```

### A/B 测试 rewrite

```ts
function abTestGuard(ctx: NavigationContext) {
    if (ctx.url.pathname !== "/landing") return next();
    const variant = bucket(ctx.getCookie("uid"));
    return variant === "B" ? rewrite("/landing-v2") : next();
}
```

用户在地址栏看到 `/landing`；服务端渲染 `/landing-v2`。客户端无可见重定向，无闪屏。

### afterLoad 分析

```ts
function trackPageView(ctx: PostLoadContext) {
    ctx.container.resolve<EventRecorder>("eventRecorder").record({
        name: "PageView",
        fields: { intentId: ctx.intent.intentId, url: ctx.url.pathname },
    });
    return next();
}
```

## 守卫顺序规则

1. 全局 `beforeLoad` 守卫（注册顺序）
2. 路由级 `beforeLoad` 守卫（数组顺序）
3. Controller `execute()`
4. 全局 `afterLoad` 守卫
5. 路由级 `afterLoad` 守卫

任一步返回非 `next()` 则停止。后续守卫不再跑。

## 异步守卫

守卫可以 `async`。管线在每个结果之间 await。全局守卫里别 await 太久（会乘到每个请求）。

```ts
async function rateLimitGuard(ctx: NavigationContext) {
    const limiter = ctx.container.resolve<RateLimiter>("rateLimiter");
    const allowed = await limiter.tryConsume(ctx.getCookie("uid") ?? "anon");
    return allowed ? next() : deny(429, "Too many requests");
}
```

## 注意事项

- **守卫对框架状态必须是纯的。** 不要改 `ctx.intent.params` —— 需要改参数就构造新 intent 然后 `rewrite`。
- **`afterLoad` 里的 `deny()` 会丢弃已产出的页面。** Controller 已经跑过了；deny 只阻断响应。如果 `execute()` 有副作用（写操作），副作用已经发生。
- **浏览器端守卫拿不到请求头。** `getHeader()` 在客户端返回 `null`。cookie 仍然可用。

## 下一步

- [渲染与 Hydration](./04-rendering-and-hydration.md) —— `afterLoad` 到 HTML 输出之间发生什么
- [陷阱：redirect vs rewrite](./pitfalls/redirect-vs-rewrite.md) —— 二者之间怎么选
