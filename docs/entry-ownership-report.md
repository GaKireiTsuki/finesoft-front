# 其它薄入口的职责收敛与验证

2026-09-20。本轮已实施并完成本地验证。基线是上一轮 Action 收敛完成后的工作区，已有改动保留，不重复计算。实施范围见[计划](superpowers/plans/2026-09-20-entry-ownership.md)。

## 实际删除的层

| 原有层次                                                   | 现在的职责归属                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `createSSRHost` 包装 `createSSRHandler`，用 `.handle` 转发 | `createSSRHandler` 自身返回 `{ fetch, dispose }`，管理响应组装、在途请求、关闭和已拥有 renderer 的释放 |
| `ownRender` 包装原生 SSR render                            | `createSSRRender` 自己等待在途渲染并释放持有的 Runtime，删除单一调用点的泛型包装文件                   |
| `createWorkerHandler` 再包装 HTTP 函数                     | `createHttpHandler` 的对象直接实现 `fetch`，Node 和 Worker 共用实际处理对象                            |
| `runStandard` 把标准结果改成 `ok/value/issues`             | Router、HTTP 和 Operation 直接使用 Standard Schema 的 `~standard.validate` 与 `value/issues`           |

删除 `server/src/ssr-host.ts`、`ssr/src/render-owner.ts` 和上述旧导出。仓内消费方、生成宿主、公开中英文文档及打包消费者同步迁移；未保留旧名转发别名。历史性能脚本仅在加载旧版本时识别旧 API，不进入运行时。

`BaseController` 的 fallback/取消、HttpClient 的拦截与安全策略、Logger/EventRecorder 的广播及失败处理、Translator 的插值与复数、SessionStore 的存储队列都有实际行为，本轮继续保留。声明构造器与 UI/平台子入口也保留各自的类型、不可变快照及依赖隔离职责。

## 所有权与兼容迁移

```ts
const http = createHttpHandler(options);
await http.fetch(request, bindings, host);

const ssr = createSSRHandler({ ...ssrOptions, ownRenderers: true });
await ssr.fetch(request, bindings);
await ssr.dispose();
```

HTTP/SSR 请求处理器由函数改为对象，调用方改用 `.fetch`。Node 宿主可直接接收处理器对象，仍支持普通 fetch 函数，并绑定对象接收者。原生页面 renderer 仍使用 `render(url, context)`，它与 HTTP 响应组装是不同的执行边界。

SSR 的 `ownRenderers` 默认 `false`，保持原低层处理器借用 renderer 的责任；标准宿主设置 `true`，承接原 `createSSRHost` 的所有权。关闭后新请求返回 503，在途请求、迟到模块加载及原生渲染完成后才清理。HMR 加载的 renderer 按身份去重，即使部分清理失败，也尝试清理全部已拥有 renderer，再聚合报告错误。

真实 workerd 拒绝函数型默认导出。因此实际处理器采用原生对象契约，并支持 `createHttpHandler(() => options)`：配置工厂在首个请求内同步执行一次，避免模块求值时创建需要随机 ID 的 Runtime。Worker 可直接 `export default createHttpHandler(createDataApp)`；不再需要业务入口自行维护懒初始化变量和转发对象。每次调用的 bindings、取消信号和任务宿主仍独立，工厂创建的 Runtime 释放责任仍归调用方。

HTTP 响应流继续在消费结束、失败或取消之后释放请求作用域；`waitUntil` 的后台任务使用独立作用域。原生 SSR 和响应组装各自保留等待边界，不能因为都具有 `dispose` 就合并成一个不区分阶段的队列。

Standard Schema 自定义校验继续支持同步返回值和 Promise，也保留 `validate` 的接收者。使用旧 `runStandard` 的消费者需直接调用 `await schema["~standard"].validate(value)`，用 `result.issues` 判断失败；不存在第二套 `ok` 协议。

## 代码量

范围为 `core/web/browser/ssr/server/front` 的 `src`，排除 `.d.ts`，不计文档、测试、脚本、模板或构建产物。基线为本轮开始时的完整源码快照。

| 指标             |  本轮前 |  本轮后 |           变化 |
| ---------------- | ------: | ------: | -------------: |
| 物理行数         |  13,487 |  13,491 |             +4 |
| UTF-8 字节       | 518,647 | 518,919 |           +272 |
| 非注释语法 token |  74,042 |  73,871 | −171（−0.23%） |

token 使用 TypeScript 解析树计算，排除空白、注释和 JSDoc；字符串内容作为字面量，生成代码字符串不再次解析。Svelte 文件只纳入行数与字节，不计 TypeScript token，且本轮未修改运行时 Svelte 文件。

本轮减少了包装对象、重复协议和调用层次，但新增 Worker 原生对象契约、首次请求初始化和明确所有权选项，因此物理行数没有下降。不能据此宣称大幅减码，更没有达到代码量减半。原始快照、逐文件结果和计数脚本在 `reports/ownership-consolidation/{baseline,before-source.json,counts.json,count.mjs}`。

## 性能对照

Node v24.21.0，同一进程、相同 Vite 源码加载配置，分别加载本轮前快照与当前源码。预热 5 轮，交替顺序测量 15 轮；每轮 30,000 次带类型校验的路由解析、1,000 次 HTTP JSON 完整消费、500 次 SSR 原生渲染到 HTML 完整消费。HTTP/SSR 同时检查请求作用域精确释放次数，SSR 检查公开投影不含私有字段。

| 每次执行中位数，μs    | 本轮前 | 本轮后 |   变化 |
| --------------------- | -----: | -----: | -----: |
| 路由解析              |  1.763 |  1.637 | −7.15% |
| HTTP 请求及 JSON 消费 | 25.527 | 25.779 | +0.99% |
| SSR 请求及 HTML 消费  | 79.314 | 77.644 | −2.10% |

HTTP 当前批次范围为 24.60–49.94 μs，基线为 24.66–26.90 μs，存在单轮高值；中位数增加约 0.25 μs。该样本未显示持续明显退化，但不宣称所有路径都更快。进程回收后堆占用约 29.56–30.78 MiB，包含同时加载的两个版本和 Vite，不能据此归因单个版本的内存差异。

计时不包含源码转换、断言、批次间事件循环等待及显式 GC；不包含网络和真实 UI，也不是线上容量结论。脚本及全部样本在 `reports/ownership-consolidation/{measure.mjs,performance.json,performance.log}`。

## 验证结果

| 验证                              | 结果                                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp install`                      | 通过                                                                                                                                               |
| `vp check`                        | 格式、lint、类型检查通过                                                                                                                           |
| `vp test`                         | 109 个文件，884 个测试通过                                                                                                                         |
| `vp run -r build`                 | 21 个任务成功                                                                                                                                      |
| `verify-portable-runtime.mjs`     | 真实 Node HTTP 与 workerd（未启用 `nodejs_compat`）通过，同一业务 fixture 的两组 bindings、投影、状态、cookies、拒绝、校验、重定向、错误和流均通过 |
| `verify-runtime-boundaries.mjs`   | 实际本地 tarball 安装，portable/React/Vue/Svelte/Node/tooling 六组声明和依赖图检查通过，manifest 已恢复                                            |
| `verify-native-renderers.mjs`     | React/Vue/Svelte 的 SSR/CSR/prerender、嵌套结构和首次错误/导航拒绝/重定向 ready 通过                                                               |
| `NATIVE_FIX_ONLY=1` 原生验证      | 三种 UI 的 reset/save/remount 通过                                                                                                                 |
| `verify-template-renderers.mjs`   | 六模板 preview、三种 minimal 模板开发加载与独立挂载通过                                                                                            |
| `verify-final-boundary-fixes.mjs` | 公共类型、文档示例、静态宿主所有权和真实浏览器根/ready/导航通过                                                                                    |
| 独立代码复核                      | 未发现可复现回归，另运行相关 49 个测试通过                                                                                                         |
| `git diff --check`                | 通过                                                                                                                                               |

新增覆盖包括 SSR 关闭时迟到模块的清理与失败聚合、借用 renderer 不被误释放、Worker 首次初始化及并发 bindings 隔离、原生 SSR 在消息加载尚未结束时关闭的成功/失败分支。已有流取消、断连、HMR、后台任务与同步/异步校验测试保留。

首次把 `vp check` 与测试并行运行时，测试创建后删除的临时 entry 导致 tsgolint 在分析启动前崩溃；测试结束后单独重跑检查通过，没有通过忽略源文件绕开检查。各验证日志保存在 `reports/ownership-consolidation/`。

以上均为本地结果，改动尚未提交、推送或部署。
