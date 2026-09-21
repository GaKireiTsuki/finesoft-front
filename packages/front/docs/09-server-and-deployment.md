# HTTP and deployment hosts

Portable data handlers return standard Responses. Bind the same operation to Node or Worker without pages, DOM, Hono, or Vite in its business module.

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

The HTTP owner executes requests through `handler.fetch(request, bindings, host)`. Node and Worker use the same object; `startNodeHandler` takes the object rather than a detached function. A factory argument initializes once inside the first request, avoiding Runtime creation during workerd module evaluation; bindings, cancellation and task hosts remain per request. `createWorkerHandler` has been removed.

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

Node’s host requires `@hono/node-server`. Worker fetch has no Node compatibility requirement for the portable graph. DNS enforcement belongs to the Node host; an unavailable required capability fails explicitly. Browser networking uses an explicit browser policy. Streaming resources live until consumption, cancellation or failure. Background work uses `runManagedTask` and host `waitUntil`; detached tasks must not retain response-owned resources. The Vite adapters emit thin host modules using the same SSR response assembler; building locally does not deploy or publish.

When `setup` is a module path, that module must `export default` its setup function. Development, preview and generated hosts use this explicit export; named functions are not discovered automatically.

## Static hosting boundary

`staticAdapter` reads built `render.routes` by default, uses the same SSR host to generate HTML and awaits cleanup. `dynamicRoutes` supplies concrete dynamic paths; `routesExport` is an explicit extension. Discovery and rendering failures fail the build. Plain HTML cannot express redirects, error status, Set-Cookie or custom HTTP response headers, so the adapter rejects these responses; choose a request host when they are required.
