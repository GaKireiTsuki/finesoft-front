# HTTP and deployment hosts

Portable data handlers return standard Responses. Bind the same operation to Node or Worker without pages, DOM, Hono, or Vite in its business module.

## Data endpoint / 数据接口

```ts
import { defineApp, defineOperation, createRuntime, ExecutionError } from "@finesoft/front";
import { defineEndpoint, createHttpHandler } from "@finesoft/front/http";
export const double = defineOperation({
    id: "double",
    kind: "query",
    handler: (value: number) => value * 2,
});
export const runtime = createRuntime({ app: defineApp({ id: "data-app", operations: [double] }) });
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
export const handler = createHttpHandler({ runtime, endpoints });
```

## Separate platform entries / 独立平台入口

```ts
// node.ts
import { startNodeHandler } from "@finesoft/front/node";
import { handler, runtime } from "./data-app";
const server = await startNodeHandler({ handler, port: 3000, disposeApp: () => runtime.dispose() });
// await server.dispose();

// worker.ts (a separate host entry)
import { createWorkerHandler } from "@finesoft/front/worker";
import { runtime, endpoints } from "./data-app";
export default createWorkerHandler({ runtime, endpoints });
```

## Web build / 页面构建

```ts
import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import { finesoftFrontViteConfig } from "@finesoft/front/vite";
export default defineConfig({
    plugins: [
        react(),
        finesoftFrontViteConfig({
            adapter: "node",
            ssr: { entry: "src/ssr.tsx" },
        }),
    ],
});
```

Node’s host requires `@hono/node-server`. Worker fetch has no Node compatibility requirement for the portable graph. DNS enforcement belongs to the Node host; an unavailable required capability fails explicitly. Browser networking uses an explicit browser policy. Streaming resources live until consumption, cancellation or failure. Background work uses `runManagedTask` and host `waitUntil`; detached tasks must not retain response-owned resources. The Vite adapters emit thin host modules using the same SSR response assembler; building locally does not deploy or publish.

## Static hosting boundary

`staticAdapter` reads built `render.routes` by default, uses the same SSR host to generate HTML and awaits cleanup. `dynamicRoutes` supplies concrete dynamic paths; `routesExport` is an explicit extension. Discovery and rendering failures fail the build. Plain HTML cannot express redirects, error status, Set-Cookie or custom HTTP response headers, so the adapter rejects these responses; choose a request host when they are required.
