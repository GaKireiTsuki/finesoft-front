# 自定义部署适配器

构建适配器实现 Vite 入口的 Adapter，负责生成部署文件、绑定平台 Request/Response 和清理能力。运行时 SSR 使用 SSR 入口的 createSSRHandler。保留唯一响应组装器，生成器必须传递请求上下文、状态、响应头、Cookie、语言和重定向。内部 buildBundle/generateSSREntry 不是公开 API。仓库 Node/Cloudflare/Netlify/Vercel 实现可作参考，宣称支持前需在目标运行时执行产物。

```ts
import type { Adapter, AdapterContext } from "@finesoft/front/vite";
// Supply { name, async build(context: AdapterContext) { ... } } as the Vite adapter.
// Runtime module:
import { createSSRHandler } from "@finesoft/front/ssr";
```

`createSSRHandler` 返回直接拥有 `fetch(request, bindings)` 与 `dispose()` 的执行对象，替代原 `createSSRHost(...).handle(...)`。标准宿主设置 `ownRenderers: true`，关闭时先等待全部响应组装结束，再按身份去重释放 renderer；未设置时 renderer 仍由调用者拥有。`createSSRRender` 自身管理原生渲染的等待与 runtime 释放。
