# 4. 渲染与 Hydration

页面从 Controller 输出到字节流再回到活着的浏览器应用要走的路。本章覆盖 SSR、CSR、prerender，以及把两端绑在一起的 `PrefetchedIntents` 机制。

## 三种模式并排比

|                          | SSR                                     | CSR                           | Prerender                               |
| ------------------------ | --------------------------------------- | ----------------------------- | --------------------------------------- |
| HTML 何时生成            | 每次请求时在服务端                      | 构建期（仅空壳）              | 构建期，按路由                          |
| 初始 body                | 完整渲染                                | 空 `<div id="app"></div>`     | 完整渲染                                |
| Hydration 时需重新请求？ | 不需要（数据在 `PrefetchedIntents` 里） | 需要（Controller 在浏览器跑） | 不需要（数据在 `PrefetchedIntents` 里） |
| TTFB                     | 一次 Controller 执行                    | 接近零                        | 静态文件直接发                          |
| 个性化                   | 按请求 OK                               | 最好 —— 完全在客户端跑        | 无（所有人同一份 HTML）                 |
| SEO                      | 好                                      | 需要支持 JS 的爬虫            | 最好                                    |

模式是**按路由**配置，自由混合。

## SSR 管线

```
请求 URL
    │
    ▼
Router.resolve()                 → RouteMatch
    │
    ▼
beforeLoad 守卫                  → 可能 rewrite（内部）/ redirect / deny
    │
    ▼
IntentDispatcher.dispatch()      → Page
    │
    ▼
afterLoad 守卫                   → 可能 redirect / deny / 发出 canonical 信号
    │
    ▼
renderApp(page)                  → { html, head, css }
    │
    ▼
injectSSRContent()               → 最终 HTML，含：
    • 渲染后的 body 放在 <!--ssr--> 里
    • head 片段放在 <!--head--> 里
    • 序列化的 PrefetchedIntents 放在 <script> 里
    • <html lang="..." dir="..."> 属性
```

### SSR 入口

```ts
// src/ssr.ts
import { createSSRRender, serializeServerData } from "@finesoft/front";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import App from "./App.vue";
import { bootstrap } from "./bootstrap";

export const render = createSSRRender({
    bootstrap,
    getErrorPage: () => ({ kind: "error", title: "Something went wrong" }),
    async renderApp(page) {
        const app = createSSRApp(App, { page });
        const html = await renderToString(app);
        return {
            html,
            head: `<title>${escape(page.title)}</title>`,
            css: "",
        };
    },
});

export { serializeServerData };
```

Vite 插件和 adapter 替你调用 `render(url, options)`。你返回 `{ html, head, css }`，框架处理注入和序列化。

### `createSSRRender` 替你做了什么

- 服务端跑一次 `bootstrap()`（同一个 worker 内跨请求缓存）
- 每个请求创建请求级 DI 容器
- 跑中间件管线
- 调用你的 `renderApp()` 产出 body
- 把 prefetched intent 结果序列化进 `<script id="__finesoft_data__">`
- 根据解析出的 locale 设置 `<html lang dir>`
- 根据 `deny()` / `redirect()` / `rewrite()` 结果设置 HTTP status
- `afterLoad` 发出 rewrite 信号时加 `Content-Location` 头

## CSR（客户端渲染）

`renderMode: "csr"` 的路由，服务端返回最小空壳：

```html
<!doctype html>
<html lang="en">
    <head>
        <!-- 这里注入 head -->
    </head>
    <body>
        <div id="app"></div>
        <!-- 没有 PrefetchedIntents script —— Controller 在浏览器跑 -->
        <script type="module" src="/src/main.ts"></script>
    </body>
</html>
```

`startBrowserApp()` 触发首次导航时 Controller 在浏览器跑。CSR 适用：

- 鉴权背后高度个性化的 dashboard
- SEO 不重要的页面
- 服务端渲染成本盖过延迟收益的页面

## Prerender（静态 + ISR）

```ts
{ path: "/about", intentId: "about", controller: new AboutController(), renderMode: "prerender" }
```

构建期框架：

1. 调 `controller.execute({}, container)`（参数来自静态路径）
2. 跑 `renderApp()` 产 HTML
3. 写 `dist/about.html` 到磁盘

adapter 直接服务这些静态文件。请求时不跑 Controller。

### 增量静态再生成（ISR）

打包的服务器（`createServer`）和预览服务器（`vp preview`）支持按需缓存的再生成。通过 `finesoftFrontViteConfig` 配置：

```ts
finesoftFrontViteConfig({
    ssr: { entry: "src/ssr.ts" },
    isr: {
        // 哪些路由按需再生成
        routes: ["/blog/*"],
        // 缓存 TTL（秒）
        ttl: 300,
    },
});
```

过期后的首个请求触发新一轮渲染；并发请求拿到陈旧版本直到新版生成完成。详见 [服务器与部署](./09-server-and-deployment.md#isr)。

## `PrefetchedIntents` —— SSR → CSR 的桥梁

关键机制：**同一个 Controller 在服务器产出页面，浏览器复用结果不重新请求。**

### 工作原理

1. SSR：Controller 跑，返回 `Page`。框架把 `(intentId, paramsKey) → Page` 存入 `PrefetchedIntents` map。
2. 渲染：map 被 JSON 序列化进 `<script id="__finesoft_data__">{...}</script>`。
3. 浏览器：`startBrowserApp` 读这个 script，调 `createPrefetchedIntentsFromDom()`，传给 `Framework.create()`。
4. 浏览器首次导航：`IntentDispatcher.dispatch()` 用 `(intentId, paramsKey)` 查 map —— 命中则直接返回缓存的 `Page`，不调 Controller。

### 稳定 key 生成

查找 key 由 `intentId` + `params` 的**稳定 JSON 字符串化**生成。对象键的顺序不影响 key：

```ts
// 下面两个产出相同的 paramsKey：
dispatch({ intentId: "product", params: { id: "42", color: "red" } });
dispatch({ intentId: "product", params: { color: "red", id: "42" } });
```

如果你写的 Controller 用不同 `params` 形状解析同一个逻辑请求，dispatch 之前先归一化。

### 缓存什么时候不命中

- 浏览器导航到未在服务端 prefetch 的 intent（例如用户点击的动态路由）
- `PrefetchedIntents.invalidate(intentId, params)` 之后变陈旧
- 浏览器端的 mutation 守卫（自定义）

不命中走普通 dispatcher 路径 —— `execute()` 在浏览器跑。

## 一步一步看 Hydration

```
服务器                          浏览器
──────                          ───────
bootstrap(framework)
    ▼                              │
controller.execute()                │
    ▼                              │
Page A                              │
    ▼                              │
serialize → <script>                │
    ▼                              │
HTML 响应 ─────────────────────▶  接收 HTML
                                    ▼
                              createPrefetchedIntentsFromDom()
                                    ▼
                              Framework.create({ prefetchedIntents })
                                    ▼
                              bootstrap(framework)    ← 同份代码、同份路由
                                    ▼
                              dispatch(currentIntent)
                                    ▼
                              缓存命中 → Page A     ← 不重新请求
                                    ▼
                              mount(app)
```

bootstrap 跑两遍 —— 两端各一次 —— 输入相同。这就是浏览器初始路由和服务端渲染 HTML 一致的保证。

## SSR head 注入

`renderApp()` 返回 `head` 片段。框架把它注入到 `<!--head-->` 占位，同时还会注入：

- `<script id="__finesoft_data__">` 序列化数据（仅 SSR 模式）
- 客户端入口的 `<link>` / `<script>`（生产构建）
- 来自解析 locale 的 `<html lang="..." dir="...">` 属性

自定义 meta 标签放进你的 `head` 字符串：

```ts
async renderApp(page) {
    return {
        html: await renderToString(/*...*/),
        head: [
            `<title>${escape(page.title)}</title>`,
            `<meta name="description" content="${escape(page.description)}">`,
            `<meta property="og:title" content="${escape(page.title)}">`,
        ].join(""),
        css: "",
    };
}
```

用户提供的字符串永远要 escape —— 它们直接进 HTML。

## CSS 注入

如果渲染产出关键 CSS（如 Vue scoped 样式、`vanilla-extract`），通过 `css` 返回：

```ts
return {
    html,
    head: `<title>${title}</title>`,
    css: extractedCriticalCss, // 作为 <style> 注入到 <head>
};
```

Vite 管理的样式表保持 `css: ""` —— Vite 插件会处理。

## 状态码

SSR 响应的 HTTP 状态按以下优先级决定：

1. 中间件结果：`deny(404)` → 404；`redirect(url, 301)` → 301 + `Location` 头。
2. 页面级：`fallback()` 返回 `kind: "error"` 的 `Page` → 500（可通过 `getErrorPage` 配置）。
3. 默认：200。

通过 `afterLoad` 覆盖：

```ts
afterLoad: [
    (ctx) => {
        if (ctx.page.kind === "not-found") return deny(404, "Not found");
        return next();
    },
],
```

## 流式 SSR

当前不支持。框架在发字节前完整 await `renderApp()`。对大多数应用够用 —— Controller 内部 `execute()` 里并发 await 多个 HTTP 调用就能并行抓数据。

如果某个大页面确实需要流式渲染，考虑用 CSR 渲染该页面 + 使用视图层自己的流式原语。

## 下一步

- [国际化](./05-i18n.md) —— locale 解析和字典加载
- [陷阱：SSR Hydration 不匹配](./pitfalls/ssr-hydration-mismatch.md) —— 两端不一致时
