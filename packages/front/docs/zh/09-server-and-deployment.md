# HTTP 与部署主机

可移植数据处理器返回标准 Response。同一操作可绑定 Node 或 Worker，业务模块无需页面、DOM、Hono、Vite。

## Data endpoint / 数据接口

```ts
import { defineApp, defineOperation, createRuntime, ExecutionError } from "@finesoft/front";
import { defineEndpoint } from "@finesoft/front";
export const double = defineOperation({
    id: "double",
    kind: "query",
    handler: (value: number) => value * 2,
});
export const endpoints = [
    defineEndpoint({
        method: "POST",
        path: "/double",
        operation: double,
        decode: async (request) => {
            const body: unknown = await request.json();
            if (typeof body !== "number" || !Number.isFinite(body))
                throw new ExecutionError("validation");
            return body;
        },
        encode: (value) => Response.json({ value }),
    }),
];
export function createDataApp() {
    const runtime = createRuntime({ app: defineApp({ id: "data-app", operations: [double] }) });
    return { runtime, endpoints };
}
```

## Separate platform entries / 独立平台入口

```ts
// node.ts
import { startNodeHandler } from "@finesoft/front";
import { createHttpHandler } from "@finesoft/front";
import { createDataApp } from "./data-app";
const options = createDataApp();
const handler = createHttpHandler(options);
const server = await startNodeHandler({
    handler,
    port: 3000,
    disposeApp: () => options.runtime.dispose(),
});
// await server.dispose();

// worker.ts (a separate host entry)
import { createHttpHandler } from "@finesoft/front";
import { createDataApp } from "./data-app";
export default createHttpHandler(createDataApp);
```

HTTP 处理器本身通过 `handler.fetch(request, bindings, host)` 执行请求，Node 与 Worker 使用同一对象；`startNodeHandler` 接收该对象，不接收单独的函数。工厂参数在首个请求内初始化一次，避免 workerd 在模块求值阶段创建 Runtime；每个请求的 bindings、取消与后台任务宿主仍独立传入。旧 `createWorkerHandler` 已删除。

## Web build / 页面构建

```ts
import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import { finesoftFrontViteConfig } from "@finesoft/front";
export default defineConfig({
    plugins: [
        react(),
        finesoftFrontViteConfig({
            adapter: "node",
            ssr: { entry: "src/ssr.ts" },
        }),
    ],
});
```

Node 主机需要 `@hono/node-server`。可移植 Worker 图无需 Node 兼容开关。DNS 校验属于 Node 主机，必需能力不可用时明确失败。浏览器网络使用显式策略。流资源保留到消费、取消或失败。后台任务使用 `runManagedTask` 与主机 `waitUntil`，不能保留响应所有的资源。Vite 适配器生成使用同一 SSR 响应组装器的薄主机模块；本地构建不等于部署发布。

当 `setup` 是模块路径时，该模块必须通过 `export default` 导出 setup 函数。开发、预览与生成的部署主机统一使用这个导出，不再自动猜测命名函数。

## 静态托管边界

`staticAdapter` 默认读取构建产物的 `render.routes`，通过同一 SSR host 生成 HTML 并等待释放；`dynamicRoutes` 提供具体动态路径，`routesExport` 仅作显式扩展。发现路由或渲染失败会令构建失败。纯 HTML 不能表达重定向、错误状态、Set-Cookie 或自定义 HTTP 响应头，因此适配器拒绝这些响应；需要它们时选择 Node/Worker 等请求主机。
