# 会话恢复的完整实现：实例保活（islands）+ 重载重建

> 状态：已锁定设计方向，待评审 spec。
> 落地分支：**`feat/session-restoration`**（不另起特性）。这是会话恢复的完整形态——per-entry 实例的「保活 + 重建」。已建的 session restoration 只做了「作用域状态序列化」，是半成品；本设计把它纳入统一的实例模型并修订之。
> 依赖/复用：结构化导航（`feat/navigation-containers`，PR #23，**未发布**）的 `NavigationController`/`NavigationHandle`/树模型；已建会话恢复的 `SessionSnapshot`/`scope`/`SessionStateProvider`/`History`/序列化（**重定位**为下文「重载层」）。

## 1. 背景与动机

会话恢复（已建）让「导航位置 + 作用域状态」可序列化、跨重载。但讨论暴露一个**根本性**问题：

1. **会话内 pop 回前页会重 fetch**（控制器只复用上一快照的可见目标）。
2. **要保留的东西是开放集合**：不止表单/滚动，还有**框架组件生命周期、`<video>`/`<audio>` 播放、第三方控件内部态（编辑器撤销栈 / 图表 / 地图 / WebGL）**，以及「后面更多的东西」。逐类「捕获/恢复」枚举不尽，且**活对象根本无法通用序列化**。
3. 当前 demo 里保留一个输入要手写 `entryKey + watch + getScoped/setScoped` —— 违背框架减负目的。

**统一洞察**：不要枚举、不要序列化活对象 —— **只要条目还在导航里，就别销毁它的实例**（对标 SwiftUI：容器视图本身管理子视图生命周期，子视图在栈上就一直活着）。实例活着 = 它的一切（组件态/DOM/滚动/媒体/第三方控件/未来的东西）免费保留，零枚举。手写 scoped 样板随之消失。

## 2. 两种 regime：保活 vs 序列化（物理事实，不是设计选择）

|      | 实例活着（会话内）             | 实例已死（跨进程：刷新/冷启动）                                        |
| ---- | ------------------------------ | ---------------------------------------------------------------------- |
| 手段 | **保活**：不销毁，什么都不用做 | **序列化重建**：进程没了，活对象消失，只能重建可序列化子集             |
| 覆盖 | 无损、全类别、零枚举           | 天然有损、部分（存得了 `currentTime`，存不了活的 `AVPlayer`/组件实例） |

→ **会话内走保活；重载走有损序列化兜底。** 服务两个物理上不同的场景。

## 3. 统一脊柱：per-entry，「在场」即活

- 身份键 `entryKey = intent + " " + stableStringify(params)`（与控制器 `destinationKey` 同源）。
- **present 集（在场）**：
    - 结构化导航 = `collectAllLeaves(tree)`（**新增**：全部存在叶子，含不可见——栈非顶 entry、未激活 tab 分支、所有 split 列）。
    - 扁平导航（升级到 islands 时）= 隐式单栈：导航 = push，back = 揭示下层活实例；离开当前 forward 路径的条目按 LRU 收（深历史有界，前进越界则走重载层重建）。
- **visible 集** = `collectVisibleDestinations(tree)` / 隐式栈顶。
- 三层全挂这根脊柱：**身份 = `entryKey`，生死 = present 集，显隐 = visible 集**。

## 4. 模型

### 4.0 两种挂载模型并存（组织主线）

| 模型                        | app 提供                             | 会话内                   | 重载                    | 适用                           |
| --------------------------- | ------------------------------------ | ------------------------ | ----------------------- | ------------------------------ |
| **基线（单 mount）**        | `mount(target) => updateFn`          | 导航整屏重渲（无活保活） | **serialize-restore ✓** | flat / 结构化，现有不破        |
| **islands（升级，opt-in）** | `mountEntry(entry, el) => {unmount}` | **活保活**（实例不销毁） | serialize-restore ✓     | flat（隐式单栈）/ 结构化（树） |

- **serialize-restore 是两模型、flat+结构化的通用基线**（已建，§4.5），所有 app 免费享有。
- **islands 是 opt-in 升级**：app 提供 `mountEntry` 即获得活保活；不提供则停留基线、只享重载恢复——**现有 flat 单 mount 应用/模版零改动、不破**。代价：框架内两套挂载路径共存。

### 4.1 视图保活 —— islands（`@finesoft/browser`，本特性核心新增）

提供 `mountEntry` 时，结构化导航的挂载从「单 mount 整树重渲」改为「**N 个独立 UI root，每 present entry 一个**」：

- **通用挂载原语**（适配器提供，跨框架一致）：
    ```ts
    mountEntry(entry: ResolvedEntry, container: HTMLElement): { unmount(): void }
    // Vue:    createApp(View, props).mount(el)   → app.unmount()
    // React:  createRoot(el).render(<View/>)     → root.unmount()
    // Svelte: new View({ target: el, props })    → comp.$destroy()
    ```
    `ResolvedEntry = { intent, params, entryKey, page }`，`page` 来自控制器（§4.4 保证稳定，只挂一次）。
- **keep-alive 逻辑全在框架**（适配器只需上面那个原语，不用 Vue `<KeepAlive>` 等框架专有机制）：
    - 进入 present 集 → `mountEntry` 一次，记入 `Map<entryKey,{container,unmount}>`。
    - 变 visible → container attach 到结构槽、显示。
    - present 但不可见 → **detach container**（§4.2），实例不 unmount、全程活着。
    - 离 present 集 → `unmount()`，从 Map 删除（同时清 page 缓存 + scope）。
- **扁平用同一编排器**：flat FlowAction handler 在提供 `mountEntry` 时，维护隐式单栈喂给编排器（push/pop），不再调 `updateApp`。

### 4.2 隐藏 = detach（节点离 document，devtools 不可见）

present-但-不可见的 island，框架**把 container 从 document 摘除**（保留元素引用 + 已挂载实例）：

- **收益**：节点出 document → devtools 看不到、`document.getElementById`/全局 `querySelector` 只命中可见屏 → **无重复 `id`、无跨屏查询歧义，屏间真隔离**。
- **代价（已接受）**：
    - **背景屏 `<video>`/`<audio>` 暂停** —— HTML 规范「media element 移出 document → pause」，无法绕过。
    - `ResizeObserver`/`IntersectionObserver` detach 时断、reveal 时重连（一般无害）。
    - **滚动**：detach 丢 layout 不丢 DOM 属性 —— `input.value`/`checked`/组件态随分离节点在内存留存，reveal 即在；唯独 `scrollTop` 依赖 layout，框架 **conceal 时记录、reveal 时 rAF 重放**（与 §4.5 共用滚动捕获逻辑）。
- **opt-out（post-v1）**：条目声明 `keepRendered` → 改 hide-in-place（`content-visibility:hidden`，留 DOM 树）以维持连续媒体。
- **生命周期信号**：框架在 container 上派发 UI 无关 `CustomEvent`：`fs:enter`/`fs:reveal`/`fs:conceal`/`fs:exit`，任意框架可监听（如 conceal 自暂停、reveal 自刷新）。

### 4.3 容器 / chrome 的 DOM 归属（islands 模型下）

- **app 顶层 `mount`** 渲染 chrome（tab bar/back/split 布局）+ 一个**稳定、空的 outlet 元素**（`<main data-fs-outlet>`，不加 `v-if`/不渲染子 VNode → 框架塞进去的节点不被 app reconcile 吞，标准「挂第三方进 ref 空容器」模式）。chrome 订阅既有 `NavigationHandle` 自由重渲。
- **框架取 outlet**：chrome `mount` 后 `target.querySelector('[data-fs-outlet]')`（UI 无关，无需 app 回传）；找不到报错引导。outlet 自身须稳定（不加 `v-if`/不换 key）。
- **框架在 outlet 内**建镜像树的结构容器（无样式，纯 `data-fs-*`，app 用 CSS 接管外观）：`data-fs-tabs > data-fs-tabbar? + data-fs-branch* > data-fs-stack > data-fs-entry*`；`data-fs-split > data-fs-column*`。island 容器是叶子内容；框架只 attach/detach/move，**从不 reconcile**。
- **跨 island 共享态**走模块级单例（`reactive`/store），不走 provide/inject（N root 隔离——islands 已知代价；vue-minimal 全局 `name` 本就模块级 `reactive`，不受影响）。

### 4.4 控制器保活 —— Part A（`@finesoft/core`，对树-承载导航生效）

控制器持 `Map<entryKey, Page>`：

- `resolveTree` 复用源从「上一快照可见目标」改为该缓存。present 条目命中 → **不重 dispatch（不重 fetch）**；主目标**守卫照常跑**（reveal 时仍能 redirect/deny，安全语义不变），只省数据拉取。
- 提交后写缓存，按 `collectAllLeaves(nextTree)` prune。
- 与 islands 协同：island 只挂一次、`page` 稳定，pop 回不触发重 fetch、不向活 island 推新 page。
- 作用域：结构化 + flat-islands（隐式栈有树）。**flat-baseline（无树）保持现有 dispatch 行为**（可选 LRU page 缓存，plan 时定）。
- **opt-in 新鲜数据**：`invalidate(target?)` 清缓存 → 重 fetch；`refresh()` = 清当前激活叶子 + 重解析（islands 下触发该 entry remount 拿新 page）。

### 4.5 重载重建 —— 通用基线（**仅**刷新/冷启动；重定位已建会话恢复）

进程死 → 实例全没 → 框架对 present 集 fresh 重挂/重渲 → 回填可序列化子集：

- **DOM 子集**（opt-in `data-restore-root` 内，**新增自动捕获**）：表单值（排除 `input[type=password]`、`[data-restore-ignore]`、无 key 字段）、滚动、`<details open>`，键 = `name`/`data-restore-key`，写入 `scope[entry].__dom`、随会话快照落 `sessionStorage`。
- **app 声明 slice**：既有 `SessionStateProvider`（保留，给非 DOM 的应用态，如全局 `name`）。
- **回填**：fresh 渲染后 rAF（+ 一次重试）写回 DOM；受控输入派发 `input`+`change`（bubbling）驱动 `v-model`/受控绑定（caveat：触发校验/`watch`、不监听原生事件的自定义组件收不到——文档化）。
- **重定位说明**：已建的手写 scoped-state（`scope.get/set` per entry）在新模型里——**会话内由 islands 保活取代**（不再需要手写样板）；**重载由上面的自动 DOM 捕获取代**（标 `data-restore-root` 即可）。`scope` 存储与 `SessionStateProvider` 保留，作为「重载层的 per-entry 序列化载体 + 应用声明态」。demo 的 `getScoped/setScoped` 样板删除。

## 5. 决策记录

| 决策                | 选择                                                         | 理由                                                                       |
| ------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 落地分支            | **`feat/session-restoration`**，框架定位为会话恢复的完整实现 | 这本就是会话恢复该有的形态；不另起特性                                     |
| 会话内保活机制      | **islands**（框架挂 N root，通用 mountEntry 原语）           | keep-alive 进框架、适配器只剩跨框架一致原语；比 `<KeepAlive>` 更 UI 无关   |
| 隐藏语义            | **detach（出 document，devtools 不可见）**                   | 屏间真隔离、无重复 id；代价是背景媒体暂停 + 滚动重放（已接受）             |
| flat 支持           | **mountEntry 作为 opt-in 升级，两模型共存**                  | serialize 兜底通用基线已覆盖 flat；想活保活则升级，现有 flat 单 mount 不破 |
| flat 历史           | 视作隐式单栈，back 全活、前进越界走重载重建                  | 浏览器历史双向无界，纯保活会爆内存                                         |
| pop 回前页          | 控制器缓存复用、不重 fetch                                   | 对标 SwiftUI 栈保活                                                        |
| reveal 时守卫       | 照常跑，只省 fetch                                           | 安全语义不变                                                               |
| chrome / island DOM | 框架拥结构容器 + island；app 拥 chrome + 叶子挂载            | 物理隔离，chrome 重渲不碰活 island                                         |
| 重载                | 有损序列化兜底（自动 DOM 子集 + slice）                      | 跨进程实例必死，物理限制                                                   |
| 安全                | opt-in `data-restore-root` + 排除 password                   | 自动持久化 DOM 值的红线                                                    |

## 6. 错误处理 / 安全

- Part A：单目标 dispatch 失败走现有 fallback，不污染缓存。
- islands：`mountEntry`/`unmount` 包错隔离（warn + 跳过该 entry）；attach/detach 幂等。
- 重载层：捕获/恢复单元素错隔离；序列化超限丢弃 + warn；password/ignore 永不进存储；合成事件包 try/catch。

## 7. 测试策略

- **core**：`collectAllLeaves`（嵌套全叶子）；控制器页面缓存——push 缓存、pop 复用**不重 dispatch**（断言 dispatcher 次数）、守卫仍跑、离树 prune 后再 push 重 fetch、切 tab 保活、`invalidate`/`refresh` 重 fetch。
- **browser（jsdom）**：island 编排器——每 present entry `mountEntry` **恰一次**、conceal 时 `removeChild` 但**不** `unmount`（断言实例存活：unmount spy 未被调）、reveal 重 `appendChild`、离树 `unmount`；`input.value` 经 detach→reveal 存活；`fs:*` 事件按生命周期派发；flat 隐式栈 push/back 驱动编排器；重载层捕获/回填 + 合成事件驱动受控值 + password 排除；基线单 mount 应用仍只走 serialize（不破）。
- **真浏览器（playwright）**：滚动 conceal→reveal 重放、`<video>` 背景暂停、devtools/document 不可见。
- jsdom 无 layout（`scrollTop` 恒 0）/ 不播媒体 → 这两类留 playwright。

## 8. 改动清单（全在 `feat/session-restoration`）

- **core**：`operations.ts` 加 `collectAllLeaves`；`controller.ts` 加 `Map<entryKey,Page>` 缓存 + `invalidate`/`refresh`；`session/scoped-state.ts` 的 `collectLeafKeys` 复用 `collectAllLeaves`。
- **browser**：新增 island 编排器（outlet → 结构容器树 → `mountEntry`/attach/detach/unmount，按 present/visible 集驱动；`fs:*` 事件；滚动 conceal/reveal 捕获重放）；`start-app.ts` 的 `navigation` 配置加 `mountEntry`（chrome 仍走现有 `mount` + `NavigationHandle`）；flat FlowAction handler 在有 `mountEntry` 时驱动隐式单栈编排器；重载回填模块（自动 DOM 子集捕获/恢复 + 合成事件）；`index.ts` 导出。基线单 mount 路径保留。
- **front**：再导出 `mountEntry`/`ResolvedEntry`/`collectAllLeaves` 等。
- **vue-minimal**：`App.vue` 收敛为 chrome（tab bar/back/header + `data-fs-outlet`，订阅 `NavigationHandle`）；页面拆为 `HomeView`/`DetailView`/`NotesView` 经 `mountEntry` 挂为 island；**删除手写 `getScoped/setScoped` 样板**，改为 island 保活 + `data-restore-root` 自动重载；保留 [App.vue:119](../../templates/vue-minimal/src/App.vue#L119) 裸 `<input>` 作零代码保活活靶。
- **文档**：本 spec + 使用指南（两挂载模型、islands 契约、detach 语义与代价、chrome/outlet 模式、查询限定屏内、重载兜底 + caveat）。
- **changeset**：`@finesoft/front: minor`（结构化导航未发布；islands 为新增 opt-in，基线单 mount 不破）。

## 9. 开放问题

- flat 隐式栈的 LRU 上限 / 前进重建策略精确形态：plan 时定（默认「保留连续访问路径活实例，截断时收」）。
- 结构化深树 island 内存上限（LRU）：v1 不做（树规模有界）。
- `mountEntry` 是否给 island 暴露 `page` 更新通道（refresh 走 remount vs setProps）：倾向 remount。
- `fs:*` 是否同时以 reactive `isVisible` prop 注入便于模板直接用：plan 时定。
- React/Svelte 适配器本期是否随附：倾向仅定 `mountEntry` 契约 + Vue 参考实现。
- 无 `name`/`data-restore-key` 字段的回退：要求显式 key，不做脆弱的自动选择器路径。
