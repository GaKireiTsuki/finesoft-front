# 高阶：内联 proxy 代码生成

serverless 和 edge 部署，想把 proxy 逻辑内联到函数 bundle 里 —— 不在运行时调 `registerProxyRoutes`，不带额外依赖 —— 框架暴露 `generateProxyCode`。

## 用例

部署到 Cloudflare Workers / Vercel Edge / AWS Lambda@Edge。每个函数有：

- 紧的冷启动预算
- 紧的冷 bundle 体积预算（Workers：1 MB 压缩后）
- 某些运行时没有 `process.env`

import proxy router 和它的支持文件（validator、Hono 集成）增字节。`generateProxyCode` **只**发出你声明的路由需要的那几行。输出自包含：几个 `app.get(...)` / `app.all(...)` 调用加一个 `_sanitizeProxyPath` helper。

## 生成的输出

输入：

```ts
import { generateProxyCode } from "@finesoft/front";

const code = generateProxyCode([
    {
        prefix: "/api",
        target: "https://upstream.example",
        headers: { "X-App": "myapp" },
        auth: { type: "bearer", envKey: "API_TOKEN" },
        cache: "max-age=60",
    },
]);

console.log(code);
```

得到大概这样的：

```js
// ─── 框架声明式代理路由 ───
function _sanitizeProxyPath(raw) {
    if (raw.length > 2048) return null;
    try {
        if (decodeURIComponent(raw) !== raw) return null;
    } catch {
        return null;
    }
    if (raw.startsWith("//")) return null;
    if (!/^[/\w.\-~%:@!$&'()*+,;=]*$/.test(raw)) return null;
    return raw.startsWith("/") ? raw : "/" + raw;
}

app.all("/api/*", async (c) => {
    const _sub = _sanitizeProxyPath(c.req.path.replace("/api", ""));
    if (!_sub) return c.text("Invalid path", 400);
    const _target = new URL(_sub, "https://upstream.example");
    if (_target.origin !== "https://upstream.example") return c.text("Invalid proxy target", 400);
    const _reqUrl = new URL(c.req.url);
    _reqUrl.searchParams.forEach((v, k) => _target.searchParams.set(k, v));
    const _headers = { "X-App": "myapp" };
    const _token =
        (typeof process !== "undefined" && process.env && process.env["API_TOKEN"]) || "";
    if (_token) _headers.Authorization = "Bearer " + _token;
    try {
        const _resp = await fetch(_target.toString(), { headers: _headers, redirect: "manual" });
        const _cl = _resp.headers.get("Content-Length");
        if (_cl && parseInt(_cl, 10) > 10485760) {
            return c.text("Proxy response too large", 502);
        }
        const _body = await _resp.arrayBuffer();
        if (_body.byteLength > 10485760) {
            return c.text("Proxy response too large", 502);
        }
        const _rh = { "Content-Type": _resp.headers.get("Content-Type") || "application/json" };
        if ("max-age=60") _rh["Cache-Control"] = "max-age=60";
        return c.newResponse(_body, _resp.status, _rh);
    } catch (_e) {
        console.error("[Proxy /api]", _e);
        return c.json({ error: "Proxy request failed" }, 502);
    }
});
```

所有都内联。proxy 路径不从 `@finesoft/front` import 任何东西。把这放进函数 bundle 里，跟 SSR 入口一起。

## 代码生成 vs 运行时注册 怎么选

| 关注点                        | 运行时（`registerProxyRoutes`） | 代码生成（`generateProxyCode`） |
| ----------------------------- | ------------------------------- | ------------------------------- |
| 长跑服务器（Node、Workers）   | ✅ 优先                         | ✅ 也行                         |
| 微小 edge 函数（Lambda@Edge） | import 更重                     | ✅ 最小                         |
| 不重新部署就更新路由          | ✅ 改配置，重启                 | ❌ 需重新部署                   |
| 配置来自远端服务              | ✅ 支持                         | ❌ 代码生成在构建期跑           |
| 多个 proxy 共享 helper        | ✅ 运行时共享                   | 自己去重否则代码重复            |

bundle 体积重要时用代码生成。多数部署运行时路径就好。

## 构建期集成

典型设置：

```ts
// scripts/build-proxy.mjs
import { generateProxyCode } from "@finesoft/front";
import { writeFile } from "node:fs/promises";

const code = generateProxyCode([
    { prefix: "/api/users", target: "https://users.internal" },
    { prefix: "/api/products", target: "https://products.internal", cache: "max-age=30" },
    {
        prefix: "/api/orders",
        target: "https://orders.internal",
        auth: { type: "bearer", envKey: "ORDERS_TOKEN" },
    },
]);

const wrapper = `
import { Hono } from "hono";
const app = new Hono();

${code}

export default app;
`;

await writeFile("dist/proxy.js", wrapper, "utf8");
```

然后在 serverless 函数入口 import `./proxy.js`：

```ts
// dist/main.ts（Cloudflare Worker）
import proxyApp from "./proxy.js";
import ssrApp from "./ssr-bundle.js";

const app = new Hono();
app.route("/", proxyApp);
app.route("/", ssrApp);

export default app;
```

## 生成代码替你做了什么

生成的 handler 强制和运行时路径同样的保证：

- **SSRF 保护**：path 校验拒绝编码字符、`//` 前缀、不允许字符集外字符
- **开放重定向保护**：`target.origin` 必须与配置的 target origin 一致
- **10 MB 响应大小限制**：`Content-Length` 快速拒绝 + `byteLength` 实际字节检查
- **二进制完整性**：`arrayBuffer()` 转发（不 UTF-8 解码）
- **从环境读 auth**：请求时读 `process.env[envKey]`

框架测试套件断言运行时和生成代码的**parity**：

```ts
// packages/server/test/proxy.test.ts
test("generated proxy code embeds the same response size limit as runtime (parity)", () => {
    const code = generateProxyCode([{ prefix: "/api", target: "https://upstream.example" }]);

    const MAX = String(10 * 1024 * 1024);
    expect(code).toContain(`parseInt(_cl, 10) > ${MAX}`);
    expect(code).toContain(`_body.byteLength > ${MAX}`);
});
```

你改运行时路径的大小限制，生成代码的限制锁步更新。

## 注意事项

### `process.env` 可能不存在

生成的代码用 `typeof process !== "undefined"` 守卫。没有 `process` 的运行时（某些 edge 环境），auth 头根本不会加 —— 上游看不到 auth。

像 Cloudflare Workers 用函数 arg 注入 env 而不是 `process.env` 的平台，你要：

- 包一层生成代码，从 worker 的 env arg 注入 auth 头
- 或生成后替换 auth 那段，改成平台对应的访问方式

### 无重试、无熔断

生成的 handler 一次 `fetch`，失败冒成 `502 Proxy request failed`。要重试 / 熔断逻辑，自己写 proxy 代码 —— `generateProxyCode` 有意最小。

### 多个 proxy 共享 helper 代码

`_sanitizeProxyPath` 在生成字符串顶部发一次。多个 `app.all` 共用。每个路由单独 `generateProxyCode` 然后拼接，helper 会重复 —— 一次传所有路由调用。

### 生成时校验

`generateProxyCode` 跑和 `registerProxyRoutes` 一样的 `validateConfig`。无效配置构建期就抛：

```ts
generateProxyCode([{ prefix: "/api", target: "file:///etc/passwd" }]);
// Error: [proxy] target must start with "https://" or "http://": "file:///etc/passwd"
```

抓配置错误在部署发出之前。

## 参考

- [第 9 章：服务器与部署 · proxy 路由](../09-server-and-deployment.md#proxy-路由)
- 实现：`packages/server/src/proxy.ts`
- parity 测试：`packages/server/test/proxy.test.ts`
