# 9. 服务器与部署

框架的服务端。本章覆盖：

- Vite 插件（`finesoftFrontViteConfig`）—— dev server、构建配置、代码生成
- `createServer` —— 独立的 Hono 服务器
- Proxy 路由 —— 带 SSRF / 二进制完整性守卫的声明式 API 转发
- Adapter —— Node、Vercel、Cloudflare、Netlify、静态

## Vite 插件

```ts
// vite.config.ts
import { finesoftFrontViteConfig } from "@finesoft/front";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [
        // ... 视图层插件（Vue/React/Svelte）
        finesoftFrontViteConfig({
            ssr: { entry: "src/ssr.ts" },
            i18n: { messagesDir: "src/locales" },
            proxies: [{ prefix: "/api", target: "https://upstream.example" }],
            adapter: "auto",
            renderModes: { "/blog/*": "prerender" },
        }),
    ],
});
```

### 选项

| 选项               | 类型                         | 说明                                                         |
| ------------------ | ---------------------------- | ------------------------------------------------------------ |
| `ssr.entry`        | `string`                     | SSR 入口路径（默认 `src/ssr.ts`）。                          |
| `i18n.messagesDir` | `string`                     | 含 `{locale}.json` 文件的目录（默认关闭）。                  |
| `proxies`          | `ProxyRouteConfig[]`         | 声明式 API 转发。详见下文。                                  |
| `adapter`          | `"auto" \| "node" \| ...`    | 目标平台。`"auto"` 从环境变量检测。                          |
| `renderModes`      | `Record<string, RenderMode>` | 按路由覆盖渲染模式（glob 键）；`"prerender"` 启用 ISR 缓存。 |

### 它做什么

Dev：

- 启动 Hono 服务器，每个请求都跑你的 SSR 入口
- 通过 Vite 模块图热重载 SSR 代码
- 本地服务 proxy 路由，让客户端 `fetch("/api/...")` 能跑通

Build：

- 用 Vite 标准管线打包客户端 bundle
- 把 SSR 入口打包成独立模块
- 生成 adapter 特定的入口文件（`vercel.func`、`_worker.js`、`node-server.js` 等）
- 把 `renderMode: "prerender"` 的路由预渲染成静态 HTML

## `createServer` —— 独立 Hono 服务器

Node 部署和测试时，框架导出一个函数给你一个开箱即用的 Hono app：

```ts
import { createServer } from "@finesoft/front";

const app = createServer({
    ssrEntry: "./dist/server/ssr.js",
    proxies: [{ prefix: "/api", target: "https://upstream.example" }],
    staticDir: "./dist/client",
});

// app 是 Hono 实例 —— 按你的运行时方式挂载
import { serve } from "@hono/node-server";
serve({ fetch: app.fetch, port: 3000 });
```

### 包含什么

- 客户端 bundle 的静态文件服务
- 所有 proxy 路由（通过 `registerProxyRoutes` 注册）
- 带完整中间件管线的 SSR 渲染
- prerendered 路由的 ISR 缓存
- 从 `Accept-Language` 解析 locale

## Proxy 路由

带内置 SSRF 保护、二进制安全转发、可配置 auth/cache 的声明式 API 转发。

### 基础配置

```ts
proxies: [
    {
        prefix: "/api",                    // 必须以 / 开头
        target: "https://api.example.com", // 必须以 https:// 或 http:// 开头
    },
],
```

现在 `GET /api/users/42` → `GET https://api.example.com/users/42`。query 参数和请求头都转发。

### 完整选项

```ts
{
    prefix: "/api/apple",
    target: "https://api.music.apple.com",
    methods: ["get", "post"],                          // 默认 ["all"]
    headers: { "X-App": "finesoft" },                  // 注入到每个请求
    auth: { type: "bearer", envKey: "APPLE_TOKEN" },   // 读 process.env.APPLE_TOKEN
    cache: "public, max-age=60",                       // 响应的 Cache-Control
    followRedirects: false,                            // 默认 false（redirect: "manual"）
}
```

`auth.type`：`"bearer"` → `Authorization: Bearer <token>`。`"basic"` → `Authorization: Basic <token>`。`envKey` 在请求时读取，所以改它（或 unset）不需要重启。

### 框架强制的保证

- **SSRF 保护**：path 包含任何 `%` 编码字符、以 `//` 开头、或含允许字符集之外的字符（`[/\w.\-~%:@!$&'()*+,;=]`）就被拒。解码后 ≠ 原始也拒（防止 `%2F` 走私）。
- **开放重定向保护**：构造出的目标 URL 必须与配置的 `target` 同 `origin`。不同 origin → `400 Invalid proxy target`。
- **二进制完整性**：响应 body 通过 `arrayBuffer()` 转发，不用 `text()` —— 精确保留字节。PDF、图片、protobuf 响应与上游响应字节相同。
- **大小限制**：10 MB。先查 `Content-Length` 头快速拒绝；fetch 后再查实际 body 长度。
- **HTTP 警告**：任何 `http://` 目标启动时打 warning。生产用 HTTPS。

### 生成的 proxy 代码（serverless / edge）

serverless 函数下，proxy 逻辑可以内联到部署的函数 bundle 而不依赖运行时的 `registerProxyRoutes`。详见 [advanced/inline-proxy-codegen](./advanced/inline-proxy-codegen.md)。

## Adapter

| Adapter        | 目标                       | 构建产物                                                |
| -------------- | -------------------------- | ------------------------------------------------------- |
| `"node"`       | 独立 Node.js 服务器        | `dist/server/index.js` —— `serve({ fetch: app.fetch })` |
| `"vercel"`     | Vercel Build Output API v3 | `.vercel/output/` 含 `functions/` 和 `static/`          |
| `"cloudflare"` | Cloudflare Workers         | `dist/_worker.js` + `dist/_routes.json`                 |
| `"netlify"`    | Netlify Functions v2       | `netlify/functions/` + `_redirects`                     |
| `"static"`     | 预渲染静态文件             | 只有 `dist/client/`（无服务器）                         |
| `"auto"`       | 构建期自动检测             | 按环境变量挑上面之一                                    |

### 自动检测

`adapter: "auto"` 按顺序检查：

1. `VERCEL=1` → vercel
2. `CF_PAGES=1` → cloudflare
3. `NETLIFY=1` → netlify
4. 否则 → node

对大多数 CI 环境管用 —— Vercel / Cloudflare / Netlify 构建期都自动设置这些。

## ISR（增量静态再生成）

把路由标 `prerender`：路由级（`renderMode: "prerender"`）或经 Vite 插件按 glob 配置（配置级优先于路由级）：

```ts
finesoftFrontViteConfig({
    ssr: { entry: "src/ssr.ts" },
    renderModes: { "/blog/*": "prerender", "/products/*": "prerender" },
});
```

`prerender` 路由有两种服务方式：

1. **构建期静态化** —— static adapter 在 build 时渲染每个 prerender 路由、写 `dist/<route>.html`（开 i18n 时按 locale 各一份）。当作纯静态文件服务，请求时不跑 controller。
2. **运行时缓存** —— 打包服务器（`createServer`）和 `vp preview` 在路由**首次**请求时渲染、把 HTML 存入内存 LRU（`ISR_CACHE_MAX = 1000` 条，按最近最少使用驱逐）。后续请求直接吐缓存、不再跑 controller。

> **无 TTL、无后台再生成。** 运行时缓存没有基于时间的过期、也没有 stale-while-revalidate —— 条目存活到被 LRU 驱逐或进程重启。「N 秒后再生成」的语义在 **CDN**、不在框架（见下）。没有 `isr` 配置项，也没有程序化失效 API。

### stale-while-revalidate 委托给 CDN

平台 adapter 在 prerender 响应上设缓存头，让边缘做真正的 ISR：

| Adapter                | prerender 响应的缓存头                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Netlify                | `Netlify-CDN-Cache-Control: max-age=3600, stale-while-revalidate=3600, durable`（真 SWR） |
| Cloudflare             | `Cache-Control: public, max-age=3600`                                                     |
| Node（自托管）/ Vercel | 无 —— 依赖内存 LRU                                                                        |

`3600` 秒窗口是各 adapter 里硬编码的常量，不可配。多实例 / 多区域部署靠 CDN 头保证一致缓存；内存 LRU 是单实例单服务器的服务。

### 缓存失效

没有程序化失效 API。要强制刷新：

- 重启服务器（清空整个内存 LRU）
- 重新部署（重建构建期静态 + 重置缓存）
- 在 Netlify / Cloudflare 上 purge 该路径的 CDN 缓存

## 自定义 Hono 中间件

如果你需要 proxy 和 SSR 之外的服务端逻辑（如 webhook、健康检查），挂到同一个 Hono app 上：

```ts
const app = createServer({ ssrEntry: "./dist/server/ssr.js" });

app.get("/health", (c) => c.json({ status: "ok" }));
app.post("/webhook", async (c) => {
    const body = await c.req.json();
    await handleWebhook(body);
    return c.json({ ok: true });
});

// SSR catch-all 由 createServer 最后注册 —— 你的路由优先。
```

## 环境变量

框架读取：

- `NODE_ENV` —— `"production"` 启用生产专用优化
- `PROXY_TOKEN` / `BASIC_TOKEN` / 任何 `auth.envKey` —— proxy 鉴权密钥
- `VERCEL`、`CF_PAGES`、`NETLIFY` —— adapter 自动检测

其他都是你的。通过 `process.env` 直接访问，或在 DI 容器里注册 config 对象：

```ts
framework.container.register("config", () => ({
    upstreamUrl: process.env.UPSTREAM_URL ?? "https://api.example.com",
    sessionSecret: requireEnv("SESSION_SECRET"),
}));
```

## 健康检查和优雅关闭

负载均衡器后的 Node 部署：

```ts
import { serve } from "@hono/node-server";

const app = createServer({
    /* ... */
});
app.get("/health", (c) => c.json({ ok: true }));

const server = serve({ fetch: app.fetch, port: 3000 });

process.on("SIGTERM", () => {
    server.close(() => {
        // 如果你拿着 Framework 引用，dispose 它
        framework.dispose();
        process.exit(0);
    });
});
```

`framework.dispose()` 递归 dispose 容器、对注册的 recorder/logger 调 `destroy()`、注销所有路由。

## 下一步

- [Feature flags、平台、PWA](./10-features-platform-pwa.md) —— 特性开关、平台检测
- [工程实践 · CI 与发布流程](./engineering/ci-release-flow.md) —— 自动化发布
- [陷阱：proxy 二进制载荷](./pitfalls/proxy-binary-payloads.md) —— 为什么 `arrayBuffer` 重要
