# Advanced: proxy code generation

`generateProxyCode` is a build-time extension exported from `@finesoft/front`. Standard adapters already integrate declared proxy routes. Application business modules should use the portable operation/HTTP APIs when they need validation, policies and scoped services.

```ts
import { generateProxyCode } from "@finesoft/front";
const source = generateProxyCode([
    {
        prefix: "/api",
        target: "https://upstream.example",
        headers: { "X-App": "myapp" },
        auth: { type: "bearer", envKey: "API_TOKEN" },
    },
]);
```

The returned source calls `registerProxyRoutes(app, config)`. A custom generated entry must import `registerProxyRoutes` from `@finesoft/front` and provide its Hono `app`; standard adapters do this automatically. Both development and generated hosts use the same path, binary-response and size-limit implementation. Treat the source as generated build output, not an application startup API. Configure secret values on the host and rebuild when declared routes change. `auth.envKey` reads `process.env` when available; hosts without `process` can supply an Authorization header in their runtime registration config. Platform bundle limits and deployment rules belong to that platform's current documentation.

For ordinary applications, configure the Vite plugin and use the standard adapter rather than copying generated handler source into application files. See [HTTP and deployment](../09-server-and-deployment.md).

Redirects are manual by default; `followRedirects: true` follows at most 20 hops within the configured origin. Responses are counted as chunks arrive and cancelled above 10 MiB with a 502, even when Content-Length is missing or false.
