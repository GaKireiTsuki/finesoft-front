# 高阶：自定义 adapter

适配框架未内置的平台。内置 adapter 有 Node、Vercel、Cloudflare、Netlify、Static。其他 —— Deno Deploy、Bun、AWS Lambda、自建本地 —— 就是自定义 adapter。

本配方端到端写一个。模式：构建期发出平台专属的入口文件，让该入口指向框架的 SSR + proxy 管线。

## adapter 做什么

构建期：

1. 把 SSR 入口（`src/ssr.ts`）打包成单 JS 文件，依赖内联。
2. 把客户端入口打成平台预期的形状（多数是 `dist/client/`）。
3. 发出**平台专属入口**，做以下事：
    - import SSR bundle
    - 以平台原生形状（Request、Lambda event 等）接收请求
    - 调 `createServer({ ssrEntry, proxies })` 并 serve 响应

框架在 `packages/server/src/adapters/shared.ts` 提供 `buildBundle`、`generateSSREntry`、`copyStaticAssets`、`prerenderRoutes`。用它们 —— 它们一致地处理了所有 adapter 的重活。

## 示例：Deno Deploy adapter

Deno Deploy 跑 ES 模块，Web 标准 Request/Response。工作流类似 Cloudflare Workers 但带原生 Deno API。

### adapter 接口

```ts
// src/lib/adapters/deno-deploy.ts
import type { AdapterDefinition, AdapterContext } from "@finesoft/front";
import { buildBundle, copyStaticAssets, generateSSREntry, prerenderRoutes } from "@finesoft/front";

export const denoDeployAdapter: AdapterDefinition = {
    name: "deno-deploy",

    async build(ctx: AdapterContext): Promise<void> {
        // 1. 打包 SSR
        const ssrEntry = generateSSREntry(ctx, {
            // Deno 支持原生 fetch / URL / Response，无需 shim
            external: [],
        });
        await buildBundle(ctx, {
            entry: ssrEntry,
            outFile: "dist/server.js",
            format: "esm",
        });

        // 2. 拷静态资源
        copyStaticAssets(ctx, "dist/client", "dist/static");

        // 3. 预渲染 prerender 路由
        await prerenderRoutes(ctx);

        // 4. 发出 Deno 入口
        writeEntryFile(
            ctx,
            "dist/main.ts",
            `
            import { createServer } from "./server.js";
            const app = createServer({
                ssrEntry: "./server.js",
                staticDir: "./static",
            });
            Deno.serve(app.fetch);
        `,
        );
    },
};
```

### 注册

```ts
// vite.config.ts
import { finesoftFrontViteConfig } from "@finesoft/front";
import { denoDeployAdapter } from "./src/lib/adapters/deno-deploy";

export default {
    plugins: [
        finesoftFrontViteConfig({
            ssr: { entry: "src/ssr.ts" },
            adapter: denoDeployAdapter,
        }),
    ],
};
```

`adapter` 选项接受字符串（内置）或 `AdapterDefinition`（自定义）。

## adapter context

`AdapterContext` 传给 `build()`，暴露：

```ts
interface AdapterContext {
    root: string; // 项目根的绝对路径
    outDir: string; // dist 目录的绝对路径
    ssrEntryPath: string; // src/ssr.ts 的解析后路径
    routes: RouteDefinition[]; // 来自 bootstrap 的路由（用于 prerender）
    proxies: ProxyRouteConfig[]; // 来自 finesoftFrontViteConfig 的 proxy 配置
    isr: IsrConfig | null; // 启用时的 ISR 配置
    env: Record<string, string>; // 构建期环境变量
}
```

通常不会用全部 —— `buildBundle` 和 `generateSSREntry` 拿它们需要的。

## 常见模式

### Edge 运行时（Workers / Deno / Bun）

标准 Web API（Request、Response、fetch）。打 ESM，target `webworker`。大多数 edge 运行时接受 default-exported handler：

```ts
export default {
    async fetch(request, env) {
        return app.fetch(request, env);
    },
};
```

`packages/server/src/adapters/cloudflare.ts` 是 Cloudflare 的标准参考。

### Lambda 风格（AWS Lambda、GCF、Azure Functions）

平台专属 event 形状。在 `Request` 之间转换：

```ts
import { app } from "./server.js";

export const handler = async (event: APIGatewayProxyEventV2) => {
    const request = lambdaEventToRequest(event);
    const response = await app.fetch(request);
    return responseToLambdaResult(response);
};
```

每个云的 SDK 都自带 event-to-request 转换的类型和 helper。直接复用，别重造。

### 多进程服务器（Bun cluster、PM2）

Bun 和现代 Node 支持 `cluster` 风格多进程 serve 利用 CPU 并行：

```ts
import { app } from "./server.js";
import { serve } from "@hono/node-server";

const port = parseInt(process.env.PORT ?? "3000", 10);
serve({ fetch: app.fetch, port });
```

每个进程独立。ISR 缓存按进程 —— 真正共享缓存要前置 CDN。

## 静态（无服务器）

`adapter: "static"` 是最简单目标 —— 一切预渲染，请求时啥都不跑。

```ts
export const staticAdapter: AdapterDefinition = {
    name: "static",
    async build(ctx) {
        // 完全跳过 SSR bundle
        await prerenderRoutes(ctx); // 每个路由都必须是 renderMode: "prerender"
        copyStaticAssets(ctx, "dist/client", "dist/static");
        // 无服务器入口 —— 只有静态文件
    },
};
```

验证每个路由都能预渲染：

```ts
if (!ctx.routes.every((r) => r.renderMode === "prerender")) {
    throw new Error("Static adapter requires every route to be renderMode: 'prerender'");
}
```

## 自动检测扩展

内置 `"auto"` adapter 按顺序查环境变量：

```ts
function detectAdapter(env: Record<string, string>): string {
    if (env.VERCEL === "1") return "vercel";
    if (env.CF_PAGES === "1") return "cloudflare";
    if (env.NETLIFY === "true") return "netlify";
    return "node";
}
```

自定义 adapter 有已知环境标签的话，在项目 `vite.config.ts` 自己包一层自动检测：

```ts
function pickAdapter() {
    if (process.env.DENO_DEPLOYMENT_ID) return denoDeployAdapter;
    return "node";
}

finesoftFrontViteConfig({
    adapter: pickAdapter(),
});
```

## 测 adapter

集成测试：跑构建，验证发出的入口：

```ts
import { describe, test, expect } from "vite-plus/test";
import { build } from "vite";
import { denoDeployAdapter } from "./deno-deploy";

describe("denoDeployAdapter", () => {
    test("emits a Deno-compatible entry", async () => {
        await build({
            root: "test/fixtures/basic",
            plugins: [
                finesoftFrontViteConfig({
                    ssr: { entry: "src/ssr.ts" },
                    adapter: denoDeployAdapter,
                }),
            ],
        });

        const entry = await readFile("test/fixtures/basic/dist/main.ts", "utf-8");
        expect(entry).toContain("Deno.serve");
        expect(entry).toContain("./server.js");
    });
});
```

冒烟测试运行时：本地起平台真打 `/`。这能抓单元测试抓不到的平台怪癖（CORS、头归一化、body 解码）。

## 坑

### 别把 Node 内置模块打进 edge 运行时

`fs`、`path`、`http` 等在 Workers / Deno 不存在。`generateSSREntry` 接 `external` 列表 —— 设成平台不兼容的模块，让打包器在构建期出错而不是部署时请求崩。

### `process.env` 每个平台不同

- Node、Vercel：`process.env.FOO`
- Cloudflare Workers：通过 `fetch()` 的 `env` 参注入秘密
- Deno：`Deno.env.get("FOO")`

框架对声明的 proxy auth key 处理 `process.env`，但你自己的运行时 env 读取要包成平台感知的 helper。

### 资源的文件系统访问

你在请求时依赖读文件（罕见；多数通过 `staticDir` serve），只有 Node 类 adapter 有原生 fs 访问。edge 运行时要把资源嵌入 bundle 或通过 KV 存代理。

## 上游贡献

自定义 adapter 针对的是流行平台但框架未内置，考虑开 PR。adapter 住 `packages/server/src/adapters/`，结构一致 —— `cloudflare.ts` 是最干净参考。

框架 adapter API 有意保持小。贡献保持最小：

- `adapters/` 里一个文件
- `auto.ts` 里一个条目用于自动检测（若适用）
- 本文档里一段

## 参考

- 内置 adapter：`packages/server/src/adapters/`
- 你会用的共享 helper：`packages/server/src/adapters/shared.ts`
- [第 9 章：服务器与部署](../09-server-and-deployment.md) —— adapter 包的是什么
