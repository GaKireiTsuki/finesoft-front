# 进阶：代理代码生成

`generateProxyCode` is a build-time extension exported from `@finesoft/front/vite`. Standard adapters already integrate declared proxy routes. Application business modules should use the portable operation/HTTP APIs when they need validation, policies and scoped services.

```ts
import { generateProxyCode } from "@finesoft/front/vite";
const source = generateProxyCode([
    {
        prefix: "/api",
        target: "https://upstream.example",
        headers: { "X-App": "myapp" },
        auth: { type: "bearer", envKey: "API_TOKEN" },
    },
]);
```

The returned source registers routes on the generated host's Hono application. Treat it as generated build output and use the matching adapter's binding conventions. It is not an independent portable operation runtime or an application startup API. Proxy configuration and secrets remain separate: configure secret values on the host, and rebuild when declared routes change. Platform bundle limits and deployment rules belong to that platform's current documentation.

For ordinary applications, configure the Vite plugin and use the standard adapter rather than copying generated handler source into application files. See [HTTP and deployment](../09-server-and-deployment.md).
