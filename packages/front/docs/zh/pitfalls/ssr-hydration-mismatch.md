# 水合不一致

浏览器与 SSR 共享同一页面声明、App 和 Outlet 视图表。SSR 使用 `createSSRRender({ definition, render: app => nativeRender(app) })`；浏览器根据 `app.shouldHydrate` 选择原生 hydrate 或 mount，完成挂载后再等待 `app.ready`。

先水合服务器快照，再恢复持久化状态。避免首次渲染读取随机数、时间或浏览器独有全局。不要在挂载前等待 ready，也不要手动改动 Outlet 的子树。

显式声明公开数据投影；嵌套对象需要嵌套声明或 codec。wire/buildId 不匹配时重新加载。排查时同时检查实际浏览器警告、页面 DOM、网络请求和 entry 身份。

整站语言应在 `defineWebApp({ configuration: { locale: "en" }, ... })` 中声明，让 SSR 与浏览器使用同一个值。SSR 组装器在 `<html>` 上输出 `lang`、`dir`；浏览器还会在所选应用容器上设置这两个属性和 `data-fs-app`，使嵌入应用能使用自己的语言而不改动宿主文档。仅在静态模板中写 `<html lang="en">`，不会配置服务端运行时的 locale。

`injectSSRContent` 会在数据脚本上附带其父容器的 DOM 校验值。`createBrowserApp` 消费有效的 SSR 数据后，在返回原生挂载句柄前核对校验值，检测属性、文本、注释和结构变化，不识别具体浏览器插件。比较对象是解析后的 HTML，不是原始 HTML 字符串；自定义元素的宿主属性及内部内容由组件自己管理，不进入比较。根容器自身的属性和应用外部节点也不在检查范围内。

DOM 已变化且可以安全替换时，`shouldHydrate` 返回 false，现有 React/Vue/Svelte 模板使用 SSR 页面数据重新挂载原生根，不重新执行页面控制器。宿主记录 `source: "hydration", code: "dom-changed", recovery: "native-mount"`。没有插件名单、全局日志过滤或反复重建循环。正常 DOM 继续水合，SPA 导航不重复检查。

存在焦点、选区、已修改表单、滚动、可编辑内容、活动媒体、自定义元素、嵌套应用或不透明的浏览器上下文时，宿主继续原生水合，记录 `recovery: "deferred"`，保留原生水合行为及诊断。这避免框架额外强制重建，但原生渲染器自身水合失败时仍不能保证状态保留。手工组装 HTML 未附带校验值，或数据脚本不直接位于所选 target 内时，保持通常的原生水合流程。

这是启动恢复边界，不是插件隔离或安全校验。校验值变化不能确定来源：插件、应用脚本及 HTML 改写服务都可能修改 DOM。它不修复 head 中的样式、组件自己的内部结构、检查之后发生的改动或扩展自身运行环境中的错误。服务端 DOM 未变化时，应用自身的水合错误仍正常报告。
