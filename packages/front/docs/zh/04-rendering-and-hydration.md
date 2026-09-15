# 渲染与水合

渲染包含两项独立选择：SSR/CSR/prerender 决定何时生成 HTML；root/entries 决定原生视图归属。标准适配器共用应用声明。

## SSR / 服务端

```ts
import { createReactSSRRender } from "@finesoft/front/renderers/react/server";
import { app } from "./app-definition";
import { views } from "./views";
export const render = createReactSSRRender({ app, renderer: views });
export { serializeServerData } from "@finesoft/front/ssr";
```

## Browser / 浏览器

```ts
import { startBrowserApp } from "@finesoft/front/browser";
import { createReactRenderer } from "@finesoft/front/renderers/react/browser";
import { app } from "./app-definition";
import { views } from "./views";
export const handle = await startBrowserApp({
    app,
    target: document.getElementById("app")!,
    renderer: createReactRenderer(views),
});
// When the owning application removes this instance:
// await handle.dispose();
```

`root` 渲染单个应用视图；`entries` 为导航条目保留原生视图，并可挂载应用外壳。同 EntryId、同 pageType 更新现有视图并保留草稿；新条目或新视图类型重新挂载。SSR 水合先于会话恢复；CSR 返回外壳；prerender 产生静态文件。符合条件的运行时 HTML 复用仍先执行当前页面、守卫及渲染，因此不承诺跳过渲染。公开数据在请求释放前投影，嵌套字段需明确声明。wire 协议/buildId 不匹配时重新加载，与会话 schema 版本独立。
