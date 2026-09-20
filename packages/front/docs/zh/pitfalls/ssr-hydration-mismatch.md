# 水合不一致

浏览器与 SSR 共享同一页面声明、App 和 Outlet 视图表。SSR 使用 `createSSRRender({ definition, render: app => nativeRender(app) })`；浏览器根据 `app.hydrate` 选择原生 hydrate 或 mount，完成挂载后再等待 `app.ready`。

先水合服务器快照，再恢复持久化状态。避免首次渲染读取随机数、时间或浏览器独有全局。不要在挂载前等待 ready，也不要手动改动 Outlet 的子树。

显式声明公开数据投影；嵌套对象需要嵌套声明或 codec。wire/buildId 不匹配时重新加载。排查时同时检查实际浏览器警告、页面 DOM、网络请求和 entry 身份。
