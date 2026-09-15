# 应用结构

跨环境声明、原生视图绑定、平台入口分别存放。

## Files / 文件

```text
src/app-definition.ts  # pages, routes, policies, optional navigation
src/views.ts           # selected UI imports and explicit pageType bindings
src/main.tsx           # standard browser start
src/ssr.tsx            # selected standard SSR renderer
src/data-app.ts        # optional independent data operations/endpoints
src/node.ts            # optional Node host
src/worker.ts          # optional Worker host
```

组件、控制器、状态、视图映射仍是业务代码。把声明从启动文件移到 app-definition 不代表成本消失。可选 module 组织静态声明，不引入运行时插件发现或第二套执行引擎。
