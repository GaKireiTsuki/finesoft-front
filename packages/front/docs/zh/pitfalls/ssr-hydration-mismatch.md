# 水合不一致

服务端、浏览器共用应用声明和视图绑定，先水合服务端 HTML，再恢复持久状态。

## Shared SSR / 共用 SSR

```ts
import { createReactSSRRender } from "@finesoft/front/renderers/react/server";
import { app } from "./app-definition";
import { views } from "./views";
export const render = createReactSSRRender({ app, renderer: views });
export { serializeServerData } from "@finesoft/front/ssr";
```

控制器数据需明确公开投影，嵌套数据需嵌套声明或 codec。严格序列化在物化之后仍拒绝未标记页面。初次渲染避免时间、随机数、浏览器全局差异。wire/build 不匹配时按设计重新加载。核查实际浏览器警告和 DOM，不能只看 HTML 字符串。
