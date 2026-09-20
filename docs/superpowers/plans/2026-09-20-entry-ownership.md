# 其它薄入口的职责收敛

沿用已实施的 Action 模式：实际执行对象拥有状态和生命周期，删除旁边仅为转发而存在的对象及第二套协议。实施后测试；允许 API 迁移，保留行为、资源所有权、类型和平台能力。

## 范围与契约

1. `createSSRHandler` 同时拥有响应组装、在途请求和关闭边界，返回带 `fetch`、`dispose` 的处理器对象。删除 `createSSRHost` 和 `.handle` 转发；标准宿主明确设置 `ownRenderers: true`，普通组装默认仍借用 renderer。HMR 不同 renderer 按身份去重，关闭等待请求后释放全部已拥有 renderer。
2. `createSSRRender` 直接拥有在途原生渲染及 retained runtime 释放，删除仅此一处使用的 `ownRender` 泛型包装。它与 HTTP 响应组装的生命周期不同，不能删除其中任一等待边界。
3. `createHttpHandler` 的执行对象直接实现原生 `fetch` 方法，Node 可直接接收此对象，也继续接收普通 fetch 函数。删除 `createWorkerHandler` 的转发对象；迁移 Worker 测试、公开文档及独立消费者。真实 workerd 探针拒绝函数型默认导出，因此统一使用原生对象契约。
4. Router、HTTP 和业务 Operation 统一使用 Standard Schema 的 `~standard.validate` 与 `value/issues` 结果，删除 `runStandard` 和 `ok` 二次包装。同步/异步校验、接收者、错误及重复参数语义保持。

`BaseController` 的 fallback/取消、HttpClient 的拦截与出站策略、Logger/EventRecorder 的广播及失败语义、Translator 的插值和复数、SessionStore 的存储队列都有实际职责。声明构造器负责快照与类型，UI/平台出口负责依赖隔离，不通过增加无关功能将其“做厚”。

## 验收

- 记录当前工作区基线，实施后验证 SSR 关闭、HMR、借用/拥有、断连，Worker 的 receiver、bindings、waitUntil、流取消，以及同步/异步 schema、错误、原生协议和路由行为。
- 运行 `vp check`、`vp test`、完整构建及生成宿主的真实浏览器/Worker/Node 验证。相同输入对比本轮前后的处理器和路由性能，检查代码量及非注释词法单元。
- 汇报删除的层、迁移方式、证据与限制，不将前一轮 Action 改动重复计入。
