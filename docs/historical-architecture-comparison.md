# 历史架构与当前实现对照

日期：2026-09-20。对照源码：`facead6ce40833f8a032da0ea78781f36b40bd1d`。以下问题描述与测量保留初次核查基线；用户确认后已在本地修复，修复结果与迁移说明见文末。

**结论：存在可复现的退化，不能把这轮演进概括成完全等价的精简。** 普通 URL 导航承担了持续保留页面的成本，同址导航增加重复历史；Web 服务入口与 DI provider 的解析出现分歧。与此同时，portable core、请求作用域、统一页面加载与公开数据投影等边界更清楚，不应为修复这些问题整体退回旧 Framework。

## 对照基准

[原文：现代全栈 TypeScript 框架架构演进](https://blog.finesoft.org/post/finesoft-front-fullstack-typescript-framework-architecture) 发布于 2026-03-18。文章强调宿主分离、显式 DI、Action/Controller、两阶段守卫和 SSR 预取复用。它没有绑定 Git 提交，也没有提供性能测试原始数据。

| 基准                     | 提交                                       | 用途                                                 |
| ------------------------ | ------------------------------------------ | ---------------------------------------------------- |
| 文章同日源码参考         | `74fac7eb803d662f5a96f2fb83d2817303ccb120` | 检查当时实现、统计规模；不声称它是文章准确对应的提交 |
| 加入结构化导航前最后版本 | `6ebd3dcbf81e148877b5004ed8527cf09014d6ef` | 行为对照的旧版，2026-06-10                           |
| 首次加入结构化导航       | `d13b834a729bccee0577467c0bd06dd299b59ac0` | 确认历史分界，2026-06-11                             |
| 当前版本                 | `facead6ce40833f8a032da0ea78781f36b40bd1d` | 对照对象，2026-09-20                                 |

行为探针提取旧版 Core/Browser 源码，在相同的当前 Vite+、React 和 Chrome 下运行；当前侧使用公开 `front/dist` 入口。这样可以比较生命周期和操作次数，不能据此还原旧版发布产物的实际耗时或包体积。没有对每个中间提交做归因，以下问题不全部归因于最近一次 WebSession 提交。

## 1. 高优先级：普通 URL 导航默认持续保留所有经过的页面

触发条件：没有配置结构化 `navigation`、没有启用 session/DOM 恢复的普通应用，连续调用 `app.navigate('/p/1')` 等 URL 导航，并使用官方 React `Outlet`。

旧版将一个当前 `Page` 交给应用的 `updateApp` 回调；本次旧版适配按页面 ID 挂载一个 React 组件。当前默认将首个页面包装成 stack，后续普通 URL 导航不断 push 新 entry，已有 entry 隐藏但继续挂载。

实际调用链：

```text
旧版 FlowAction → 路由/守卫/dispatch → updateApp({ page }) → 当前页面组件

当前 navigate(url) → WebSession.push → 增长的 stack
                  → publish 保留树内所有 entry
                  → Outlet 遍历 snapshot.entries → 隐藏的页面仍挂载
```

连续 100 次不同 URL 导航后的实测结果，包含初始页面：

| 指标                                      | 旧版 |   当前 |
| ----------------------------------------- | ---: | -----: |
| 仍挂载的页面组件                          |    1 |    101 |
| 页面 DOM 元素                             |    1 |    101 |
| 页面组件函数累计执行次数                  |  101 |  5,151 |
| 页面 handler 累计执行次数                 |  101 |    101 |
| 当前 `history.state` JSON 的 UTF-8 字节数 |   45 | 11,873 |

当前只有 1 个 entry 可见，但 101 个 entry 留在快照和 DOM 中。这个最小 React 页面在每次导航时连同隐藏页面一起重新执行，因此本探针的累计组件执行次数按三角数增长。数据加载次数相同，额外成本来自状态保留和视图更新。

这已经是默认普通导航相对旧版的生命周期与资源成本退化。隐藏的组件仍然存活，不能把 `hidden` 当成卸载。显式 stack/tab 保留草稿是合理能力，但目前普通 URL 应用也自动承担了这种持续保留成本。

两侧在应用与原生 root 退出后均卸载了全部组件。本结论是**会话存活期间的无界保留**，不是已证明的永久内存泄漏；没有测量堆字节、生产环境耗时或实际卡顿，不将 5,151/101 解读成“运行慢 51 倍”。Vue/Svelte 的具体重复渲染次数也未按此探针测量。

源码证据：

- [默认初始化为 stack](/Users/megumi/Desktop/projects/finesoft-front/packages/web/src/application/initial-navigation.ts:24)。
- [普通 URL 走 push](/Users/megumi/Desktop/projects/finesoft-front/packages/browser/src/start-app.ts:245)，[push 新建 leaf 与历史模式](/Users/megumi/Desktop/projects/finesoft-front/packages/web/src/application/session.ts:694)。
- [只移除已不在树中的 entry](/Users/megumi/Desktop/projects/finesoft-front/packages/web/src/application/session.ts:650)。
- [React Outlet 遍历所有 entry，使用 hidden](/Users/megumi/Desktop/projects/finesoft-front/packages/front/src/react.ts:34)。
- [旧版单 page 更新入口](/Users/megumi/Desktop/projects/finesoft-front/reports/historical-architecture/baseline-source/packages/browser/src/action-handlers/flow-action.ts:109)。

建议：在同一 WebSession 中区分普通 URL 页替换与显式保留栈；浏览器 back/forward 的历史恢复和原生组件保留分别定义策略。普通应用默认应保持有界的活跃页面集合，显式结构化导航继续保留所需状态。只给 React 加 memo 不能解决持续增加的 entry、DOM 和 history 数据。

## 2. 中优先级：重复导航当前 URL 增加历史与页面副本

在独立的新浏览器页面内，连续三次导航到当前完整路径：

| 指标             | 旧版  | 当前  |
| ---------------- | ----- | ----- |
| `history.length` | 2 → 2 | 2 → 5 |
| 仍挂载的页面组件 | 1 → 1 | 1 → 4 |

旧版以 `url === pathname + search` 判定替换当前历史；当前 `navigate()` 无条件进入普通 push 分支，产生新的 entry ID 和历史记录。这会使一次普通同址刷新变成多个相同地址的历史项，并重复挂载页面。

来源是上一项相同的导航决策，但这是独立的用户可见语义变化。探针直接验证了历史数量和组件副本，没有额外声称测试了逐次点击后退的视觉效果。

证据：[旧版 shouldReplace](/Users/megumi/Desktop/projects/finesoft-front/reports/historical-architecture/baseline-source/packages/browser/src/action-handlers/flow-action.ts:65)，[当前 navigate 分支](/Users/megumi/Desktop/projects/finesoft-front/packages/browser/src/start-app.ts:223)。

建议：明确普通同址导航的 replace/reload 语义；显式 `navigation.push()` 仍可创建同目标的多个实例。不能通过禁止所有重复目标来破坏合法的结构化多实例能力。

## 3. 中优先级：DI 仍存在，但服务替换不再贯穿 Web 入口

旧版 Framework 的 locale、translator 和内部 logger 从 Container 解析。当前 runtime 明确允许业务 provider 覆盖默认 token，但 WebRuntime 的三个 getter 直接使用配置闭包，没有查询这些 provider。

探针同时配置默认语言 `en`，再注册 runtime 生命周期的自定义 `LOCALE`、`TRANSLATOR` 和 `LOGGER` provider。它们不涉及异步工厂或请求作用域歧义：

| 观察点                                      | 旧版            | 当前                 |
| ------------------------------------------- | --------------- | -------------------- |
| 容器读取的 locale                           | 自定义 `fr/rtl` | 自定义 `fr/rtl`      |
| Web/Framework getter 的 locale              | 自定义 `fr/rtl` | 配置默认 `en/ltr`    |
| getter 是否返回自定义 translator            | 是              | 否，返回 `undefined` |
| 框架/Web getter 的日志是否进入自定义 logger | 是              | 否                   |

当前 `context.get()` 能读到自定义服务，`app.locale`、`app.translator` 和浏览器宿主使用的 getter 却走另一条来源。因而可能出现业务显示语言与 DOM 属性不一致、自定义翻译器对视图不可见、宿主日志没有进入业务注入的采集器等结果。探针验证的是这些 getter 的实际输出；没有把结论扩大到所有日志通道。

证据：[默认 provider 覆盖规则](/Users/megumi/Desktop/projects/finesoft-front/packages/web/src/application/runtime.ts:208)、[绕过 provider 的 getter](/Users/megumi/Desktop/projects/finesoft-front/packages/web/src/application/runtime.ts:239)、[浏览器使用 getter 设置语言属性](/Users/megumi/Desktop/projects/finesoft-front/packages/browser/src/start-app.ts:194)、[WebSession 的 locale/translator 委托](/Users/megumi/Desktop/projects/finesoft-front/packages/web/src/application/session.ts:760)。

因此，关于“仍采用 DI/IoC”的结论需要限定：**业务执行层仍支持显式 provider 注入，Web 宿主服务的替换一致性存在回归。** 旧版内部本来也直接创建 Container、Router 和 Dispatcher，不能把旧版描述成所有对象都由容器注入的纯 IoC 架构。

建议：确定各服务的唯一解析来源与生命周期，默认配置负责构造默认 provider，宿主与业务共享有效服务解析规则。不要为了兼容同步 getter 而新增一套独立服务缓存；请求级 locale/translator 也不能提升成跨请求单例。

## 4. 低优先级：公开 Controller 示例仍使用已删除的调用方式

[BaseController 的 JSDoc 示例](/Users/megumi/Desktop/projects/finesoft-front/packages/core/src/intents/base-controller.ts:18) 仍写 `execute(params, container: Container)` 和 `container.resolve(...)`，也进入了构建后的公开声明文件。

对公开构建入口做类型验证，原示例得到 `TS2416`（execute 参数不兼容）和 `TS2339`（Container 没有 resolve）；改用 `ExecutionContext`、typed token 与 `context.get()` 的等价示例通过。这属于迁移文档未随实现更新，不能解释成 BaseController 能力本身被删除。

## 保留的能力和合理的架构变化

| 关注点           | 当前事实                                                                                                                   | 判断                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 宿主隔离         | portable root 与 `/web`、`/browser`、`/ssr`、`/http`、`/node`、`/worker`、`/vite` 分开；UI peers 可选；core 有依赖边界测试 | 边界更明确，包和入口增加本身不构成劣化                                              |
| 执行与注入       | RuntimeHandle 管执行和策略，Container 支持 typed provider 与生命周期；WebSession 管页面状态                                | 职责拆分合理，但第 3 项破坏了部分服务替换的一致性                                   |
| Action           | Flow、External、Compound、类型守卫和 modal 分支仍在；浏览器提供具体执行能力                                                | 没有发现文章描述的这组能力被整体取消                                                |
| Controller       | `execute → fallback` 保留，函数 handler 也能使用；取消执行不会作为普通业务错误降级                                         | 保留能力并允许更轻的写法；公开示例需要修正                                          |
| 两阶段守卫       | `loadPage()` 统一 beforeLoad、执行、afterLoad；deny/redirect 在页面提交前处理                                              | 共用实现更清楚；旧版 afterLoad deny 分支仍向 UI 返回 page，不能把旧版当成无缺陷基线 |
| SSR/hydration    | PrefetchedIntents、按 entry 对应的预取和一次性消费仍在；`markPublic` 与嵌套投影保留；请求资源释放前物化公开数据            | 文章对应能力保留，数据边界更明确                                                    |
| 原生组件生命周期 | entry ID 和 page type 控制组件身份，隐藏 entry 可保留状态                                                                  | 对显式结构化场景有价值，默认普通导航的成本退化见第 1 项                             |
| 工具链           | 当前继续使用 Vite+、strict TypeScript 和 workspace 构建                                                                    | 延续原方向，测试全部通过仍不代表复杂度和性能等价                                    |

当前实现对应的主要证据：

- [公开 exports 与可选 peers](/Users/megumi/Desktop/projects/finesoft-front/packages/front/package.json:15)，[core 依赖边界测试](/Users/megumi/Desktop/projects/finesoft-front/packages/core/test/boundaries.test.ts:7)。
- [Action 分支与 modal 加载](/Users/megumi/Desktop/projects/finesoft-front/packages/browser/src/start-app.ts:386)，[Controller 取消与 fallback](/Users/megumi/Desktop/projects/finesoft-front/packages/core/src/intents/base-controller.ts:64)。
- [统一 before/after 页面加载](/Users/megumi/Desktop/projects/finesoft-front/packages/web/src/application/load-page.ts:105)，[SSR 物化再渲染](/Users/megumi/Desktop/projects/finesoft-front/packages/ssr/src/create-render.ts:110)，[公开字段投影与安全序列化](/Users/megumi/Desktop/projects/finesoft-front/packages/ssr/src/server-data.ts:20)。

文章对 fallback 的表达比代码保证更强：旧版默认 fallback 同样会重新抛错，需要应用覆写才能返回降级结果。文章也没有给出“微秒级”水合的可重复测量，不能用它推断旧版更快。本次不把这些文字承诺当成回归验收指标。

## 代码规模

统一口径：六个运行时包的 `src` 下 `.ts/.tsx/.svelte`，排除声明文件；不含测试、文档、脚本、站点、模板和构建产物。数字是文本行数，包含注释与空行，不等于可删除的逻辑行数，也不等于浏览器下载体积。

| 包       | 文章同日参考 | 结构化导航加入前 |       当前 |
| -------- | -----------: | ---------------: | ---------: |
| core     |        1,839 |            4,132 |      3,347 |
| web      |            0 |                0 |      4,841 |
| browser  |          727 |              921 |      2,004 |
| ssr      |          326 |              552 |        524 |
| server   |        2,490 |            2,717 |      2,700 |
| front    |           67 |               68 |        240 |
| **合计** |    **5,449** |        **8,390** | **13,656** |

当前比结构化导航加入前多 **5,266 行，约 62.8%**；比文章同日参考多 **8,207 行，约 150.6%**。新增结构化导航、session 恢复、独立操作/HTTP 执行、provider 作用域与原生适配承担了一部分增量，不能据此直接判定这些行全是冗余。但这确实已经不是文章时期相同规模的轻量内核，不能用拆包、薄导出或者入口数量替代实际减量证明。

后续减量应先保证普通应用无需支付不需要的状态保留成本，再用同一组行为契约衡量共享实现和删除代码的效果。保留单一 WebSession/Runtime 执行链，避免为恢复普通 URL 语义重新复制旧导航引擎。

## 验证记录与局限

- 当前工作区依赖安装成功；`vp check` 通过；`vp test`：**109 个文件、864 项测试通过**。
- `vp run --filter '@finesoft/front...' build` 重新构建公开包及依赖成功；随后重跑浏览器、DI 和公开示例类型探针，结果一致。
- Chrome `153.0.8010.47` 的两侧 100 次 URL 导航探针均无页面/控制台错误；同址导航另开页面统计，避免浏览器历史数量上限影响结果。
- DI 探针分别运行旧版源码与当前公开构建入口，观察到上述 getter 分歧。
- 公开 Controller 示例通过 TypeScript 验证复现失败，更新调用方式的对照示例通过。
- 没有做旧版完整依赖环境重建、生产耗时对照、堆快照或所有平台的端到端复测。现有测试通过与本次新发现并不矛盾：原有测试没有覆盖本次普通导航增长及 Web getter 与 provider 一致性的验收场景。

本地复现命令（依赖已经通过 `vp install` 安装）：

```bash
vp run --filter '@finesoft/front...' build
vp exec node reports/historical-architecture/compare-browser.mjs
vp exec node reports/historical-architecture/compare-di.mjs
vp exec tsc --ignoreConfig --noEmit --strict --skipLibCheck --target esnext --module esnext --moduleResolution bundler reports/historical-architecture/published-example-old.ts
vp exec tsc --ignoreConfig --noEmit --strict --skipLibCheck --target esnext --module esnext --moduleResolution bundler reports/historical-architecture/published-example-current.ts
```

旧示例的非零退出码是本次预期复现结果。探针、旧版提取源码及原始结果保存在 Git 忽略的本地 `reports/historical-architecture/`，不会自动随本报告入库：

- [浏览器原始结果](/Users/megumi/Desktop/projects/finesoft-front/reports/historical-architecture/browser-results.json)
- [DI 原始结果](/Users/megumi/Desktop/projects/finesoft-front/reports/historical-architecture/di-results.json)
- [类型验证结果](/Users/megumi/Desktop/projects/finesoft-front/reports/historical-architecture/type-results.json)
- [源码规模统计](/Users/megumi/Desktop/projects/finesoft-front/reports/historical-architecture/source-metrics.json)
- [测试日志](/Users/megumi/Desktop/projects/finesoft-front/reports/historical-architecture/tests.log)
- [构建日志](/Users/megumi/Desktop/projects/finesoft-front/reports/historical-architecture/build.log)
- [格式、lint 和类型检查日志](/Users/megumi/Desktop/projects/finesoft-front/reports/historical-architecture/check.log)

修正顺序建议：普通 URL 的生命周期与历史语义 → DI 服务解析一致性 → 公开示例。每项以本次失败场景和现有结构化导航、modal、SSR、恢复契约共同验收，再继续讨论减量比例。

## 确认后的修复结果

普通应用的 URL 导航继续使用同一 WebSession 的 hydrate/refresh/事务链；离开的 entry 从树与视图中释放，同址导航刷新原 entry。配置了 `navigation` 或 `navigationCodec` 的应用继续保留结构，显式 push 同目标仍创建独立实例，没有恢复另一套导航引擎。

相同 Chrome/React 探针在重新构建后复测：

| 指标                                 | 修复前 | 修复后 |
| ------------------------------------ | -----: | -----: |
| 100 次不同 URL 导航后仍挂载的页面    |    101 |      1 |
| 页面组件累计执行次数                 |  5,151 |    101 |
| 页面 handler 累计执行次数            |    101 |    101 |
| 当前 history.state JSON UTF-8 字节数 | 11,873 |    293 |
| 同址导航三次后的 history.length      |  2 → 5 |  2 → 2 |
| 同址导航三次后仍挂载的页面           |  1 → 4 |  1 → 1 |

Web 服务 getter 改为从现有 Container 解析 provider。浏览器宿主作用域随 WebRuntime 释放，SSR getter 和视图显式使用请求 execution；未新增另一套 provider 注册或解析机制，WebSession 保存解析后的服务引用供原生视图同步读取。对照探针中的 locale、translator、logger 现在均与注入服务一致，宿主日志进入自定义 logger。异步 provider、LOGGER_FACTORY 覆盖、缺省可选服务、自定义工厂错误，以及并发 SSR 请求中的服务身份和释放时机均有回归用例。

`resolveLocale` 返回的完整 lang/dir 作为默认 locale provider 输入，SSR 视图、业务和响应属性保持一致；自定义 LOCALE provider 优先。BaseController 的公开 JSDoc 已改为 typed token、ExecutionContext 和 `await context.get()`。

迁移说明：

- 直接使用低层 `WebRuntime.getLocale/getTranslator/getLogger` 时改用 `await`；请求代码应传入已有 execution。标准 Browser/SSR 入口已适配，原生视图的 `app.locale/app.translator` 仍同步读取。
- `SSRRenderConfig.resolveLocale` 返回类型统一为 `LocaleAttributes`，dir 为 `ltr | rtl`；命名回调可标注该返回类型。
- 普通 URL 导航不保留离开页面的组件或草稿；需要该行为的应用应显式声明导航结构。显式栈的 push/pop、隐藏草稿、tab/split 和持久化恢复继续保留。
- 原生验收中旧的“普通链接保留隐藏页面”断言已改为卸载断言；草稿保留断言迁到显式 push/pop 场景，并新增同址历史、前进和后退检查。

新增回归后，`vp check` 无诊断，`vp test` 共 109 个文件、871 项通过。公开包及依赖、六套模板均重新构建通过。React/Vue/Svelte 的 SSR、CSR、prerender 九种组合、Tabs/Split/嵌套 Stack，以及首次 404、拒绝导航和重定向就绪检查均通过；六模板 preview、三套 minimal 的生成加载器和独立挂载也通过。

补充的原生 reset/save/remount 专项曾在复用 SSR 预构建缓存时遇到 Svelte `Symbol(filename)` 错误。验证脚本改为每次使用独立缓存、结束后清理，三个 UI 的同一专项全部通过；没有因此修改框架的 Svelte 实现。该专项仍检查页面类型改变后只清除旧 DOM 草稿、保留业务状态，并在保存和重新挂载后保持结果。

修复后的本地证据：[浏览器对照](/Users/megumi/Desktop/projects/finesoft-front/reports/historical-architecture/fix-browser-results.json)、[DI 对照](/Users/megumi/Desktop/projects/finesoft-front/reports/historical-architecture/fix-di-results.json)、[测试日志](/Users/megumi/Desktop/projects/finesoft-front/reports/historical-architecture/fix-tests.log)、[原生浏览器日志](/Users/megumi/Desktop/projects/finesoft-front/reports/historical-architecture/fix-native.log)、[恢复专项](/Users/megumi/Desktop/projects/finesoft-front/reports/historical-architecture/fix-native-reset.log)、[模板验收](/Users/megumi/Desktop/projects/finesoft-front/reports/historical-architecture/fix-templates.log)。这些仍是本地验证，不代表提交、推送或发布。
