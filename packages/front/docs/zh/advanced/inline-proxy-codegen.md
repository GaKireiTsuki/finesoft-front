# 进阶：代理代码生成

`generateProxyCode` 是 `@finesoft/front` 导出的构建期扩展。标准适配器已经集成声明式代理路由。业务模块需要校验、策略和作用域服务时，应使用可移植的操作与 HTTP API。

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

返回的源码调用 `registerProxyRoutes(app, config)`。自定义生成入口需要从 `@finesoft/front` 导入 `registerProxyRoutes` 并提供 Hono `app`；标准适配器自动完成这些绑定。开发环境和生成主机共用路径校验、二进制响应与大小限制实现。它属于构建产物，不是应用启动 API。密钥值配置在主机上，路由声明变化后重新构建。`auth.envKey` 在可用时读取 `process.env`；没有 `process` 的主机可在运行时注册配置中提供 Authorization 请求头。平台包体限制及部署规则以该平台当前文档为准。

普通应用配置 Vite 插件并使用标准适配器即可，无需把生成的 handler 源码复制到业务文件。见 [HTTP 与部署](../09-server-and-deployment.md)。

默认不跟随重定向；`followRedirects: true` 只允许目标 origin 内的跳转，最多 20 次。响应按块计数，超过 10 MiB 立即取消读取并返回 502，即使 Content-Length 缺失或不实也执行限制。
