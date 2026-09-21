# 渲染与水合

SSR、CSR、prerender 决定 HTML 的生成时机。三种模式都使用相同页面会话和单个原生应用根，布局包住 Outlet；不再选择 root/entries 模式，也没有单独 chrome 根。

浏览器调用 `createBrowserApp({ definition, target })`，用原生 API 挂载或水合相同的 App，再等待 `app.ready`。SSR 调用 `createSSRRender({ definition, render: app => nativeRender(app) })`。完整 React 代码见[快速开始](./01-getting-started.md)，Vue/Svelte 模板使用各自的原生 API。

Outlet 订阅稳定的 `AppSnapshot`，以 EntryId 保持外层元素，以 EntryId 与 pageType 共同确定页面组件身份。隐藏 entry 仍在同一组件树中，草稿与 context 保留；类型变化重建内部页面。原生提交钩子只确认实际提交的 revision，框架随后恢复对应页面的滚动和 DOM 状态。

SSR 在释放请求资源前物化公开投影，原生组件只渲染一次。水合协议明确包含 `{ tree, pages }`，每份页面数据关联 entry。协议版本或 buildId 不匹配时重新加载；会话持久化另有版本。被守卫拒绝的页面数据不进入 wire。

标准 SSR 组装流程会生成初始 DOM 的校验值。原生挂载前发现 DOM 已变化，且没有需要保留的浏览器状态时，框架会使用同一份 SSR 数据选择重新挂载，无需按插件编写规则。详见[水合恢复及其边界](./pitfalls/ssr-hydration-mismatch.md)。

CSR 返回 HTML shell。prerender 输出静态 HTML；运行时公开 HTML 缓存仍先运行本次守卫与渲染，不能视为跳过业务执行。清理时应用先等待会话 dispose，再卸载自己的原生根。
