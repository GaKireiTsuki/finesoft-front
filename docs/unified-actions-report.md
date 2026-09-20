# Action 职责收敛实施与验证

2026-09-20：已在本地完成实施与验证。普通 URL 和结构化导航都由 Action 执行，删除独立导航命令对象及重复转发层。本报告相对本轮开始时的工作区统计，包含此前导航生命周期与服务解析修复的状态作为基线，不将此前改动计为本轮收益。

## 实际职责

| 所有者                                 | 本轮行为                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| ActionDispatcher / WebSession 同一实例 | 注册处理器、执行组合动作、统一取消代次；持有唯一导航队列、页面缓存和展示快照                                                              |
| FlowAction                             | 解析 URL 并选择普通页面替换或应用声明的结构化路由；支持独立模态会话                                                                       |
| TreeAction                             | push、pop、popToRoot、popTo、replaceTop、selectTab、selectColumn、setVisibility、hydrate、reuseEntry、refresh，直接进入原有守卫和提交事务 |
| History 桥                             | 记录历史、处理 popstate、等待页面及原生确认后恢复滚动，返回清理能力                                                                       |
| SessionStore                           | 页面直接使用实际 Store；浏览器在原对象上绑定恢复门控、定时保存和释放，DOM 恢复始终读取最新 scope                                          |

移除了 `NavigationCommands`、`NavigationOperation`、`NAVIGATION_OP_KINDS`、`apply`、导航便捷方法、`app.navigation`、`app.actionDispatcher`、`SessionAccess`、重复的 NavigationHandle / SessionHandle 转发及 `getEntries()`。`FlowAction.entryId` 的实例复用语义统一为 `reuseEntry` Action。公开导出、消费者、六模板及中英文文档已迁移。

业务 Operation 的 query/command、Runtime、DI 容器、执行作用域、纯导航树函数以及宿主/UI 的公开打包边界仍有独立职责，继续保留。迁移示例见[应用 Action](../packages/front/docs/zh/advanced/custom-action-handler.md)，设计依据见[职责收敛方案](superpowers/specs/2026-09-20-unified-actions-design.md)。

## 保留能力与本轮修复

- 普通 URL 离页卸载，同址 URL 刷新原实例；显式 push 保留独立实例。Stack、Tab、Split、树恢复、实例复用、markPublic 与 SSR 请求隔离保留。
- 模态不修改背景导航与历史；Compound 可顺序混合 URL、树、模态、外链和自定义处理器。拒绝及取消阻止后续副作用。
- 新 URL 取消旧动作组；显式传入的 AbortSignal 传至页面守卫和执行作用域。新树动作阻止仍在异步解析的旧 URL 覆盖它，同时树操作继续排队；模态和外链不取代背景导航。
- SessionStore 恢复时会更换 scope。真实浏览器测试发现并修复了 DOM 恢复持有旧 scope 的问题，输入恢复及后续保存均访问新 scope。
- 独立代码审查发现的旧 Compound 继续执行、慢 URL 覆盖新树动作两项问题已修复并增加行为回归测试。对后续性能优化的复核未发现新的回归。

## 验证结果

实施完成后执行，最终代码全部通过：

| 命令                                                                 | 结果                                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `vp install`                                                         | 依赖安装完成                                                                                                       |
| `vp check`                                                           | 608 个文件格式检查；461 个文件 lint 和类型检查通过                                                                 |
| `vp test`                                                            | 109 个测试文件、880 项测试通过                                                                                     |
| `vp run -r build`                                                    | 21 个构建任务完成                                                                                                  |
| `vp exec node scripts/verify-native-renderers.mjs`                   | Chrome 中 React / Vue / Svelte × SSR / CSR / prerender，Tabs / Split / 嵌套 Stack，404 / 拒绝 / 重定向就绪边界通过 |
| `NATIVE_FIX_ONLY=1 vp exec node scripts/verify-native-renderers.mjs` | 三种 UI 的页面类型重置、保存及卸载重建通过                                                                         |
| `vp exec node scripts/verify-template-renderers.mjs`                 | 六模板生产预览及三个 minimal 模板生成 loader、独立挂载通过                                                         |
| `vp exec node scripts/verify-final-boundary-fixes.mjs`               | 会话拒绝和重定向恢复、SSR 安全呈现、静态生成、文档类型及原生提交边界通过                                           |
| `git diff --check`                                                   | 无空白错误                                                                                                         |

完整本地日志位于 `reports/action-consolidation/final-*.log`。

## 代码量与性能

统计六个运行时包 `packages/{core,web,browser,ssr,server,front}/src` 的物理行数，排除声明产物，不包含测试、文档或模板：**13,706 → 13,487，净减 219 行（1.60%）**。这次消除了重复职责和 API，但没有实现代码量减半。动作取消和竞争检查增加了必要执行逻辑；未通过删除测试或取消能力减少行数。

性能基线由本轮开始前的 HEAD 加当时工作区补丁重建。两个版本在同一 Node 进程中用相同 Vite 配置加载源码；预热五轮，交替测量十五组，每组每版执行 10,000 次 push/pop 转换和 5,000 次会话创建、启动、释放。计时不含模块转换、UI 或网络；每个测量块之间让出事件循环并回收，等待和回收时间不计入表中。

| 本地微基准               | 基线中位数 | 当前中位数 | 差值               |
| ------------------------ | ---------- | ---------- | ------------------ |
| 一次结构化导航           | 15.51 μs   | 15.81 μs   | +0.30 μs（+1.96%） |
| 一次会话创建、启动、释放 | 29.23 μs   | 30.76 μs   | +1.53 μs（+5.24%） |

优化已减少逐实例属性描述符复制及额外 Promise 层，但最终微基准仍有小幅开销，不能据此宣称性能提升。样本范围分别为导航基线 14.37–17.04 μs / 当前 14.86–17.36 μs，会话基线 28.00–30.79 μs / 当前 29.19–32.71 μs；这些是本机微基准，不是生产吞吐保证。

扩大采样时，无间断微任务循环曾使测量进程耗尽内存，失败日志已保留。分批让出事件循环和回收后，两版均完成测量，30 个采样点的进程堆保持在 28.97–29.37 MiB（包含 Vite 和两个源码版本），未观察到随轮次持续增长。这说明本次分批测量未出现持续保留增长，不能替代长期生产压力验证。

本地复现：`vp exec node --expose-gc reports/action-consolidation/measure.mjs`。输入补丁、基线、逐轮性能和代码量记录分别位于同目录的 `before.patch`、`baseline/`、`performance.json`、`source-counts.json`；无间断测量失败保留为 `performance-no-yield-oom.log`。

本轮尚未提交、推送或发布。旧命令 API 已移除，下游需按迁移文档改为 Action。
