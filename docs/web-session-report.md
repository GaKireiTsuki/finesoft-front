# WebSession 实施与验证

基线为 `4b3fa621289d189f46dc088c530f80d09467e311`，实现与修复提交为 `4639f87`、`980853b`、`f8570ae`，验证选择器修正为 `037ca0b`。WebSession 已实施并通过本地验证：109 个测试文件、864 项测试、17 项构建，以及原生浏览器和六套独立生成应用。主工作区集成状态见文末。

## 所有权和迁移

`createWebSession` 直接承担原导航事务实现，没有包装并保留旧控制器。一个 Map 按 EntryId 保存可见及隐藏页面，其插入顺序就是原生挂载顺序；导航树、可见目标、保留条目、摘要和 revision 同步发布为同一份不可变 AppSnapshot。删除了 `createAppView` 的第二份状态、控制器到视图的订阅及 `createNavigationSessionAdapter` 转发对象。

| 旧入口                                            | 新入口                                                                                  | 已迁移消费者                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| createNavigationController / NavigationController | createWebSession / WebSession                                                           | Web 测试、Browser、SSR、公开入口探针                  |
| createAppView({ controller, ... })                | 将 navigate/perform/commit/session 回调交给 createWebSession；直接以会话作为 WebAppView | Browser、SSR、modal                                   |
| presentation.present(initialCandidate)            | session.start()                                                                         | 标准 Browser/SSR、modal 首次加载                      |
| createNavigationSessionAdapter(controller)        | SessionStore({ navigation: session })                                                   | Browser、持久化及边界验证                             |
| SessionNavigationAdapter.capture/apply            | SessionNavigation.captureNavigation/restoreNavigation                                   | Store、Browser bridge、自定义端口测试                 |
| createSessionBridge({ adapter })                  | createSessionBridge({ navigation })                                                     | Browser 与 bridge 测试                                |
| browserApp.hydrate 布尔标志                       | browserApp.shouldHydrate                                                                | 六模板、React/Vue/Svelte 原生探针、对抗应用、双语文档 |

导航 `hydrate(tree)` 仍保留。布尔标志改名避免覆盖同一会话上的方法；主导航、隐藏草稿和存储恢复仍走该方法。History bridge 的操作句柄直接引用会话方法，不再生成一组转发函数。

## 保留的边界

- `resolve/apply` 返回未提交的失败候选；成功返回值与 getSnapshot 是同一对象。首次失败仅呈现安全错误，使用显式初始失败阶段保留原始导航输入；refresh、结构操作、持久化和下一次策略的 from 均继续针对该输入。首次成功提交前，展示页全部禁止数据复用，提交时清除未通过完整事务的旧展示记录；不触发失败候选的成功提交步骤。
- `onCommit(next, previous)` 明确传递前后快照，在原生订阅前捕获 DOM 并识别页面类型变化。DOM 草稿清理在新原生根确认后完成，避免卸载获焦点输入时补发的 change 重新写回旧值。普通观察者异常不影响提交；必需步骤失败仍抛出带 committed 标记的 NavigationCommitError。
- EntryId、ResourceKey、取消代次和原生 revision 继续分别管理。取消导航、迟到结果、队列以及执行作用域的释放逻辑保留。
- SessionStore 的异步存储、provider、深链门控、版本校验与 scope 不合入页面缓存。Session 与 hydration 序列化格式不变，不需要清空或迁移已有草稿。
- SSR 仍在请求资源释放前显式 materializeServerData，遵守 markPublic。统一内存快照不意味着页面私有字段进入 hydration。
- Flow、modal、ExternalUrl、自定义 action 和 Compound 路径保留，modal 使用独立 WebSession，不修改主导航。

## 验证和修复

按用户要求先实施，再测试，没有删除旧能力测试。`vp check` 零诊断；`vp test` 109 个文件、864 项通过；`vp run -r build` 17 个构建及 4 个模板同步任务通过。

独立 Codex Security `assess-patch-risk` 对固定补丁 `4b3fa62..4639f87` 评估为 revise，发现两项 P2：首次事务拒绝丢失刷新/结构导航/持久化目标，首次分栏部分失败误用成功栏的未提交数据。两项均已修复，6 个回归实例从失败转为通过，包含切离再返回和策略 from 状态。原评估严格保留其提交与 SHA 身份；修复后由实施者运行回归及完整验证，没有宣称重新独立审查。报告和经官方校验的 JSON 位于 `/Users/megumi/.codex/assessments/finesoft-front-web-session-20260920/`。

原生探针另复现了基线已有的 DOM 草稿问题：React 卸载获焦点输入框补发 change，旧输入在 host 清理后重新写回。修复将清理放在原生 revision 确认后，只清 __dom，保留业务切片。React/Vue/Svelte 三套更换页型→保存→销毁→重新挂载→刷新均通过。替代页的测试组件也实际消费原生 context，探针选择可见 entry，避免把保留的隐藏页算作当前页。

- 原生 Chrome 全量 14 组通过：worker、三 UI × SSR/CSR/prerender、组合 Tabs/Split/Stack、三 UI 的初始 404/拒绝/重定向确认；覆盖独立实例、隐藏草稿、上下文、取消迟到结果、链接、重载和 history。
- 三 UI 的 DOM 重建探针额外 3 组通过，同时重跑了 3 组错误/重定向探针。
- 六模板生产预览及三套开发模式独立挂载共 9 组通过，无记录到的控制台/hydration 错误。
- 实际 front tarball 在仓库外供六套生成应用安装，TypeScript、Vue/Svelte 原生检查及 client/SSR 构建均通过。tarball SHA-256 为 `79bc5ab1fb53a1e66505e53b6fbfba40405500d77e182ed5425bbc35bc6e9c74`。
- 迁移后的公开入口边界脚本通过，包含拒绝/重定向恢复、SSR、静态 adapter、正反例公开类型与真实原生挂载。

首次冷工作区检查因未构建公开声明及未迁移的测试端口失败，构建并修正后通过。旧 bridge 补 undefined 的参数个数断言迁移为直接共享方法断言，实际操作断言保留。Svelte 开发 SSR 曾受临时依赖缓存影响返回 500；隔离该工作区缓存后完整与定向浏览器验证均通过，未据此改动框架行为。

## 实际减量

同一物理运行时源码口径，包含 Core/Web/Browser/SSR/Server/Front 的 src、排除声明/测试/产物：

| 指标           |    基线 |    本批 |               变化 |
| -------------- | ------: | ------: | -----------------: |
| 文件           |     149 |     148 |                 −1 |
| 行数           |  13,760 |  13,656 | **−104（−0.76%）** |
| 非注释词法单元 |  76,581 |  76,045 |               −536 |
| 字节           | 527,221 | 522,429 |             −4,792 |

运行时删除量已经扣除 WebSession 替代实现、首次失败处理及 DOM 修复。不是靠移走文件或删掉能力获得的数字；但也远未达到减半目标。维护范围内测试/原生探针净增 294 行、验证脚本净增 15 行、模板入口净变 0 行。因此不含文档和一次性测量产物的整个维护补丁是 **净增 205 行**，不能把它描述成全仓代码减量。一次性测量脚本另保存在 reports 中，不进入运行时或发布包。

本批证明的是删除第二个状态发布层、重复索引和适配器可行，并带来小幅运行时缩减。页面直接执行原型的否决不变，其他宿主收敛尚未实施，不能预支其收益。

## 性能和产物

构建后的公开入口，7 轮交替执行；每场景预热 300 次、采样 3,000 次；两个外部观察者和全部 guard/handler 次数断言相同。

| 场景                 | 基线中位数 | 本批中位数 |   差异 |
| -------------------- | ---------: | ---------: | -----: |
| 新加载导航           |  16.421 μs |  14.446 μs | −12.0% |
| 保留 32 个标签的切换 |  24.529 μs |  18.912 μs | −22.9% |
| URL 加载独立进程对照 |   9.692 μs |   9.647 μs |  −0.5% |
| SSR 请求中位数       | 0.13425 ms | 0.13692 ms |  +2.0% |
| SSR 请求 p95         | 0.33367 ms | 0.33283 ms |  −0.2% |

每轮 3,300 次导航的内部 controller→view 转发从 3,300 次降为 0，两个外部观察者均各收到 3,300 次通知。32 标签只加载 32 次页面，保留复用次数未减少。

同进程 URL 对照初测有约 +10% 波动，因此额外使用 5 轮交替独立进程、每轮预热 3,000 次/采样 20,000 次，结果如表。SSR 用 3 轮交替新进程、每轮预热 20/采样 100 次；序列化大小均为 791 字节，HTML 响应均为 2,222 字节。六模板客户端 JS 原始大小各减 466–489 字节，gzip 差异为 −8 至 +39 字节，基本持平。

结果没有显示稳定的性能退化，也不证明线上延迟或内存泄漏情况。SSR 的小幅中位数差异、GC/JIT、缓存及操作系统调度噪声均应保留；内存采样不是泄漏证明。原始数据、脚本、构建/测试日志、浏览器及独立消费者证据在 `reports/web-session/`。

## 实施决定和集成

- 遵守用户“先实施、后测试”的顺序；`onCommit` 显式提供前后快照，替代旧视图对象的隐式时序。如果调用方仍读取旧快照，需要迁移回调参数。
- `shouldHydrate` 与 `hydrate(tree)` 分开命名；仓库调用方已迁移，仓库外旧 API 用户须按上表迁移。
- 首次失败呈现与真实提交区分，以原始输入保留重试/持久化能力；不另建发布层，不让错误或未提交页面进入保留缓存。
- 采纳独立审查两项问题；其余未审查范围维持原边界：历史文档不作为当前 API、既有无关 HTTP/部署逻辑不借机改写。没有遗留的轻微审查项。
- 已按既有授权将增量同步到本地 main 工作区；再次执行 `vp install`、`vp run -r build`、`vp check`、`vp test` 均通过，主工作区同样为 109 个文件、864 项测试通过。51 个补丁路径与隔离分支逐字节一致；同步后核对其余 102 个原有路径及 Git index 均未变化，随后仅更新高层方案的实施状态。50 个暂存模板删除及原有未提交改动保留。
- 实现和验证提交保存在 `refactor/web-session`。同步完成时，main 中为与原有工作合并的未提交内容；没有创建 main 合并提交、推送或发布。此处记录提交前的集成状态，后续本地提交以 Git 历史为准。主工作区日志与文件一致性证据保存在 `reports/web-session/main-*.log`、`main-source-parity.json` 和 `integration-state.json`。
