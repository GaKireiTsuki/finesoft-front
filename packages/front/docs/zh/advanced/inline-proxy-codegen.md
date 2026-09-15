# 进阶：代理代码生成

`generateProxyCode` 是 `@finesoft/front/vite` 导出的构建期扩展。标准适配器已经集成声明式代理路由。业务模块需要校验、策略和作用域服务时，应使用可移植的操作与 HTTP API。

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

返回的源码会在生成的主机 Hono 应用上注册路由。它属于构建产物，应遵循对应适配器的绑定约定，不是独立的操作运行时或应用启动 API。代理配置与密钥分别管理：密钥值配置在主机上，路由声明变化后重新构建。平台包体限制及部署规则以该平台当前文档为准。

普通应用配置 Vite 插件并使用标准适配器即可，无需把生成的 handler 源码复制到业务文件。见 [HTTP 与部署](../09-server-and-deployment.md)。
