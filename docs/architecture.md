# 应用执行与原生组件边界

通用操作、Web 页面会话、浏览器、SSR 与宿主入口分别承担各自的生命周期。普通页面与 tabs/stack/split 共用一种接入方式：应用创建原生 React、Vue、Svelte 根，布局包住 Outlet。实施依据见[整体简化方案](superpowers/specs/2026-09-16-native-composition-design.md)，命令与验证记录见[本轮验收](native-composition-acceptance.md)。本地实现与验证不代表发布或线上部署。

## 公开入口

| 入口                        | 责任                                                                             |
| --------------------------- | -------------------------------------------------------------------------------- |
| `@finesoft/front`           | Operation、Runtime、ExecutionContext、token/provider、日志、网络策略与可移植工具 |
| `/web`                      | 页面声明、路由、守卫、导航事务、不可变展示快照、会话存储与公开数据投影契约       |
| `/browser`                  | 原生挂载前的会话准备、真实链接、history、提交后滚动与 DOM 恢复                   |
| `/ssr`                      | 共用页面准备、请求资源、一次原生渲染、公开 wire 与 HTML                          |
| `/react`、`/vue`、`/svelte` | 订阅、Outlet、稳定 key 与原生提交确认                                            |
| `/http`                     | 显式 endpoint、纯路径匹配、标准 Request/Response 与流资源所有权                  |
| `/node`、`/worker`          | 平台能力与监听/请求宿主                                                          |
| `/vite`                     | 开发装配、构建插件与部署产物适配器                                               |

内部包保持私有。应用仅从公开聚合包或其子入口导入。Core/Web/Browser/SSR 不导入 UI 框架；可选 UI peers 随应用选择安装。

## 执行与依赖

Operation 归一化后直接选择实现并调用 `handler(input, context)`。宿主 override、输入输出校验、策略和取消仍在同一执行链中。类式业务可选 `BaseController.execute({ params, query, context })` 与 `fallback({ params, query, context, error })`，不再重复声明 intentId，也没有 IntentDispatcher 的第二份注册表。

依赖统一使用 token/provider 与异步 `context.get(token)`。runtime、scope、transient 生命周期、解析去重和释放顺序归 Container 管理。Web 使用 Core Runtime 和执行作用域，不再另建容器复制依赖。可选 locale、translator、平台及日志服务按需解析。

WebRuntime 的 `getLocale/getTranslator/getLogger` 同样是异步 provider 查询，直接调用时需要 `await`；可传入当前 execution。浏览器使用由 WebRuntime 持有、随应用释放的宿主执行作用域；SSR 显式传入当前请求的 execution，视图与业务共用请求服务。`WebSession.start()` 等待 locale/translator 后再准备页面，原生视图中的 `app.locale/app.translator` 仍为同步属性。默认配置只负责提供默认服务，业务 provider 覆盖后不会被 Web getter 绕过。

查询缓存只在显式配置时启用。默认缓存键接受受约束的普通数据，区分 undefined、对象与数组；Date、Map、循环和其他不可可靠编码的输入需声明 `cache.key`。完成结果使用有界 LRU。进行中查询仅在同一 execution、各调用校验与策略完成之后合并。失效推进代次：新调用不加入旧 Promise，旧结果不回填缓存。

一次 `context.invalidate(tags)` 同时通知关联 Web 会话。会话保守地标记保留页面数据过期，下次加载重取；EntryId 与原生组件草稿继续保留。进行中导航的旧数据不得越过失效代次提交。

operation 与 PageView 共用 EventRecorder，记录器与普通观察者异常不会改变业务结果。Logger 保留诊断级别，方法返回 void。安全业务错误通过 ExecutionError 表达；上游 HttpError 只映射已知安全类别，body/cause 不直接公开。

## 页面、路由与导航

```ts
import { int } from "@finesoft/front";
import { definePage, defineWebApp, markPublic } from "@finesoft/front/web";
const product = definePage({
    id: "product",
    routes: [{ path: "/products/:id", params: { id: int() } }],
    handler: ({ id }: { id: number }) =>
        markPublic(
            {
                id: String(id),
                pageType: "product" as const,
                title: `Product ${id}`,
            },
            [],
        ),
});
export const definition = defineWebApp({
    id: "example",
    pages: [product],
    getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
});
```

页面声明拥有路由，不再平行登记 controllers/routes。`navigation({ url, match, target })` 接收已经过 codec 校验的匹配，可将目标放入应用的 tabs/stack/split。反向路由使用结构化描述，不解析调试字符串。纯路径编译由 Web 与 HTTP 共用：先匹配编码路径，再解码捕获值一次，`%2F` 保持为一个参数；畸形编码不成为有效匹配。

`createWebSession` 是导航树、按 EntryId 保留的页面和原生快照的唯一所有者。`getSnapshot()` 返回同一份稳定 `AppSnapshot`，会话本身是 `ActionDispatcher`，`perform(Action)` 直接执行 URL 和结构化导航；每次成功提交只发布一次。`onCommit(next, previous)` 在普通订阅通知之前执行，宿主据此比较页面类型并捕获离开页面的 DOM 状态；新原生根确认后清除旧类型的 DOM 草稿，保留业务切片。持久化直接使用会话的 `captureNavigation/restoreNavigation`，不再构造控制器、展示层和导航适配器三个对象。

结构化 Action 的失败候选仍不提交，组合 Action 在此停止后续副作用。宿主首次使用 `start()`：成功提交正常页面；首次拒绝仅呈现安全错误，不写入被拒绝的页面或触发成功提交步骤。首次失败阶段仍使用原始输入进行刷新、结构导航和持久化，所有失败展示记录都禁止保留复用；首个成功提交结束该阶段。后续拒绝保留已有快照。

事务顺序是 admission → beforeLoad → operation → afterLoad → beforeCommit → commit → 必需宿主步骤与原生提交。普通观察者异常隔离；history 或原生提交失败通过带 `committed: true` 的 NavigationCommitError 表达，不能当成提交前拒绝。守卫拒绝保持原快照、预取和草稿。SSR 将拒绝转换成安全错误展示，不公开被拒绝页面。

| 身份              | 含义                     |
| ----------------- | ------------------------ |
| Operation/page id | 业务执行身份             |
| pageType          | 原生视图类别             |
| resourceKey       | 业务目标及参数身份       |
| EntryId           | 导航实例、组件与草稿身份 |
| revision          | 不可变展示快照的提交版本 |

## 原生根、提交与恢复

没有声明 `navigation` 或 `navigationCodec` 的普通应用，URL 导航替换当前页面树，离开的页面会卸载；每次不同 URL 仍新增浏览器历史，back/forward 通过历史树恢复目标并重新运行守卫。同址 URL 导航刷新当前 entry，不增加历史或页面副本。需要 URL 跳转继续保留页面时，显式声明 stack/tab/split；直接 `perform({ kind: "push", intent, params })` 也继续创建独立保留实例。`perform({ kind: "pop" })` 操作结构化栈，浏览器后退由 History 处理。

应用使用原生 mount/hydrate API 创建一个根，Provider/Layout 包住 Outlet。Outlet 按 EntryId 保持外层元素；页面组件 key 同时包含 pageType，类型改变时重建。隐藏 entry 仍留在原生树中，context 和局部状态自然继承。

`createBrowserApp({ definition, target })` 完成准备并返回句柄。应用根据 `app.shouldHydrate` 选择原生 hydrate 或 mount，挂载后才等待 `app.ready`。原生绑定在实际提交后同步确认该 revision；确认自身不等待会话恢复。第一次确认之后，框架允许该轮 native provider 完成注册，再读取和恢复持久化会话，避免互相等待。滚动恢复只作用于仍然当前的已提交版本。

History 桥只负责历史和滚动，没有导航转发句柄；浏览器直接扩展 SessionStore 的生命周期，页面持久化与 DOM 恢复使用该 Store。自定义处理器通过 `app.onAction/removeAction` 注册，独立的 `app.actionDispatcher` 已移除。

Action 的迁移、行为验证、代码量和本地性能测量见[职责收敛实施报告](unified-actions-report.md)。

真实 `<a href>` 导航保留修饰键、新窗口、download、外链和锚点语义。每个 target 只归一个应用；同一窗口只允许一个地址栏所有者，嵌入实例使用 memory history。DOM 恢复以应用根和 entry 为边界，不读取嵌套应用输入。

启用 session 时必须提供稳定 persistenceKey。相邻未启动的隐式 save 合并；显式快照、load、restore、clear 保持顺序边界。provider 管理业务切片，DOM 层只管理标记的输入与滚动。清理时先等待 app.dispose 捕获并完成存储工作，再卸载原生根。

## SSR、wire 与宿主

`createSSRRender({ definition, render: app => nativeRender(app) })` 对普通与组合页面使用同一准备流程。请求 scope 覆盖守卫、业务加载、公开数据物化和一次原生渲染。响应结束后释放 scope；可复用 Runtime 由 render.dispose 释放。

`createSSRRender` 自身等待在途原生渲染后再释放 Runtime。`createSSRHandler` 返回 `{ fetch, dispose }`，直接承担 HTML 响应组装、在途请求与关闭，不再通过 `createSSRHost` 或 `ownRender` 另包一层。普通处理器默认借用 renderer；标准宿主显式设置 `ownRenderers: true`，关闭时等待请求和迟到的模块加载，再按身份释放全部已拥有 renderer。原生渲染与 HTTP 响应组装的等待边界各自保留。

wire v2 明确包含 `{ tree, pages }`，页面数据绑定 entry，不再用特殊 Intent 携带导航树。协议版本与成对 buildId 校验失败时重新加载。session 与业务切片有独立版本；不把 wire 兼容性当作会话迁移。

CSR 返回 shell，prerender 构建静态 HTML。静态 adapter 读取 built `render.routes`，动态路径通过 dynamicRoutes 或显式 routesExport 扩展。纯静态文件无法表达重定向、非 200 状态或响应头，遇到这些结果必须失败或改用请求宿主。

HTTP endpoint 支持参数路径、异步 schema 与明确方法分派。同方法同形状重复声明被拒绝；结构命中但方法不匹配返回 405 与 Allow。流响应在 EOF、error 或 cancel 后才释放执行资源。Node/Worker 的差异停留在能力注入与宿主层。

`createHttpHandler` 的同一个对象直接执行 `fetch(request, bindings, host)`，Node 可接收该对象，Worker 可直接将其默认导出，不再构造 `createWorkerHandler` 转发对象。传入配置工厂时，HTTP 对象在首次请求中初始化一次，使 Worker 无需在模块求值阶段创建 Runtime。每次调用仍独立传入 bindings 和任务宿主，Runtime 的释放责任保持由应用或 Node 宿主显式持有。

Router、HTTP 参数与 Operation 输入输出都直接消费 Standard Schema 的 `~standard.validate`、`value/issues`，删除 `runStandard` 的第二套 `ok` 结果协议。其它薄入口的迁移、代码量和实测结果见[职责归属实施报告](entry-ownership-report.md)。

## 被移除的职责

删除了 Framework 第二套装配、IntentDispatcher、字符串 DI、Net 与旧 Metrics、命令式多根 renderer/islands/chrome、URL-only session、导航树哨兵、旧生产启动路径和框架内业务货架模型。六模板使用普通原生布局、真实链接与原生状态，框架没有把这些旧执行链藏在新入口后面。

本轮代码量、公开依赖图、生产产物及性能测量在验收记录中按相同口径列出。过去的[应用边界验收](application-boundaries-acceptance.md)保留为历史基线，不能替代本轮验证，也不能仅凭职责减少宣称更快。

A cancelled navigation releases the queue for the next generation. A handler that ignores its abort signal may still finish later; its generation cannot commit, and its execution resources remain owned until it settles. Disposal waits for that outstanding work.
