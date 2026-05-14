# 陷阱：redirect 与 rewrite

## 症状 A —— 地址栏里 URL 不对

守卫跑了 `rewrite("/canonical")`，但用户在地址栏看到 `/canonical`。你本来想保留原 URL。

## 症状 B —— 多了一次往返

守卫跑了 `redirect("/login")`，浏览器闪 / 网络面板里看到 302 → 200 一来一回。你本来想进程内重路由。

## 症状 C —— `afterLoad` rewrite 看起来发了 301

`afterLoad` 里的守卫返回 `rewrite("/clean-url")`。浏览器去访问 rewrite URL，拿到 canonical 内容，服务器日志里两次请求。你只想要一次。

## 根因

`redirect` 和 `rewrite` 看起来像但语义完全不同，并且 `rewrite` 在 `beforeLoad` 和 `afterLoad` 里行为也不同。

| 结果                              | 发生什么                                                               | 用户视角                   | 适用                                    |
| --------------------------------- | ---------------------------------------------------------------------- | -------------------------- | --------------------------------------- |
| `redirect("/foo", 302)`           | HTTP 302 带 `Location: /foo`（服务端）或 `pushState("/foo")`（浏览器） | 地址栏变成 `/foo`          | auth 拦截、locale 重定向、废弃路径      |
| `redirect("/foo", 301)`           | 同上但可缓存为永久                                                     | 地址栏变；缓存             | 永久 canonicalization                   |
| `rewrite("/foo")` 在 `beforeLoad` | Router 改解析 `/foo`；新 match 的守卫 + Controller 跑                  | 地址栏保持原样             | A/B 测试、feature-flag 路由、内部别名   |
| `rewrite("/foo")` 在 `afterLoad`  | `Content-Location: /foo` 头；Controller 已经跑过                       | 地址栏保持原样；无额外请求 | 给爬虫的 canonical 信号；analytics 去重 |

## 语义差异

**Redirect** = 「用户应该去另一个 URL」。地址栏是真相之源，框架告诉浏览器更新。

**`beforeLoad` 里的 rewrite** = 「这个 URL 内部映射到另一个」。用户 URL 不变；框架挑不同的 Controller 满足请求。类似 Nginx 的 `rewrite ... last;`。

**`afterLoad` 里的 rewrite** = 「这个内容也能在 canonical URL 找到」。页面已经渲染（Controller 已经跑），响应里只是带个 `Content-Location` hint。浏览器**不**像 redirect 那样跟着跳 —— 这是元数据。

## 修症状 A —— 想要 `rewrite` 用成了 `redirect`

```ts
// 不好 —— 用户在地址栏看到 /landing-v2
function abTestGuard(ctx: NavigationContext) {
    if (ctx.url.pathname !== "/landing") return next();
    return bucket(ctx) === "B" ? redirect("/landing-v2") : next();
}
```

```ts
// 好 —— 用户保持 /landing，服务端内部渲染 /landing-v2
function abTestGuard(ctx: NavigationContext) {
    if (ctx.url.pathname !== "/landing") return next();
    return bucket(ctx) === "B" ? rewrite("/landing-v2") : next();
}
```

移动路由、feature flag、locale 内容切换 —— 任何你不希望用户察觉底层 URL 变了的场景都一样。

## 修症状 B —— 想要 `redirect` 用成了 `rewrite`

```ts
// 不好 —— 用户仍在受保护 URL；跑了错的 Controller
function authGuard(ctx: NavigationContext) {
    if (!ctx.getCookie("token")) return rewrite("/login");
    return next();
}
```

这里用 `rewrite` 会：

- 地址栏停在 `/admin`（迷惑 —— 用户以为已经到 admin）
- reload 重跑登录页逻辑但 URL 不变
- 这种状态下书签 `/admin` 是个坏 URL

```ts
// 好 —— 真的导航到 /login
function authGuard(ctx: NavigationContext) {
    if (!ctx.getCookie("token"))
        return redirect("/login?next=" + encodeURIComponent(ctx.url.pathname));
    return next();
}
```

## 修症状 C —— `afterLoad` rewrite 是 canonicalization 不是 301

你确实想从 `afterLoad` 发 301，用 `redirect`：

```ts
afterLoad: [
    (ctx) => {
        if (ctx.url.search.includes("utm_")) {
            const clean = ctx.url.pathname;
            return redirect(clean, 301);
        }
        return next();
    },
],
```

但注意：`afterLoad` 跑的时候，**Controller 已经执行完了**。如果 `execute()` 有副作用（写、昂贵计算），副作用已经发生。要在工作跑之前 redirect 就用 `beforeLoad`。

如果你想发出已渲染的页面**并且**信号「另外，canonical URL 是 /clean」：

```ts
afterLoad: [
    (ctx) => {
        if (ctx.url.search.includes("utm_")) {
            return rewrite(ctx.url.pathname);  // 无额外请求
        }
        return next();
    },
],
```

响应带 `Content-Location: /clean`。爬虫（Google、Bing）用它解析 canonical；分析工具能去重各种变体。

## `rewrite` 递归深度限制

`beforeLoad` 里的 rewrite 会递归 —— 新 URL 的 `beforeLoad` 链完整跑，包括它触发的任何 rewrite。框架限定**最多 5 层**（`MAX_SSR_REWRITE_DEPTH`），防失控循环。

撞到：

```
Error: Too many SSR rewrites (max 5): /a → /b → /c → /d → /e → /f
```

说明你有守卫循环。常见原因：一个守卫 rewrite 到某 URL，那 URL 的守卫又 rewrite 回来。

```ts
// 不好 —— /landing rewrite 到 /v2，/v2 又 rewrite 回 /landing
const landingGuard = (ctx) => (ctx.url.pathname === "/landing" ? rewrite("/v2") : next());
const v2Guard = (ctx) =>
    ctx.url.pathname === "/v2" && !ctx.getCookie("v2") ? rewrite("/landing") : next();
```

修循环本身，别动深度限制。

## 决策树

```
要改用户看到的 URL 吗？
├── 是 → redirect（临时用 302，永久用 301）
└── 否，URL 保持
    ├── 要切换跑哪个 Controller？     → beforeLoad 里 rewrite
    ├── 已经渲染，想要 canonical 信号？ → afterLoad 里 rewrite
    └── 要带错误码中止？               → deny(status, message)
```

## 参考

- [第 3 章：中间件](../03-middleware.md) —— 四种结果详解
- 行为变更是有意引入的 —— 见 `packages/ssr/src/render.ts` 的 `ssrRenderInternal` 和 `rewriteUrl` 字段
