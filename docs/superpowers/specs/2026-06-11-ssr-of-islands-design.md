# SSR-of-islands —— 服务端渲染 island 首屏内容 + 客户端水合

> 状态:已确认（2026-06-11）。分支 `feat/session-restoration` 的后续增强（与会话恢复正交）。
> 本特性是 islands 架构的「后续跟进」项（见 `templates/vue-minimal/src/ssr.ts` 既有注释）。

## 1. 目标与背景

当前 islands 架构是 **content-CSR**:SSR 只渲 chrome（header / tabbar / 空 `<main data-fs-outlet>`），
页面**内容**为客户端 islands，首屏 island 复用 SSR 预取结果（`PrefetchedIntents`）但在浏览器侧才挂载渲染。

代价:首屏 HTML 的 outlet 是空的 —— island 内容不进初始 HTML（不利 SEO）、首屏到 JS 接管之间 outlet 空白（潜在闪烁 / CLS）。

**本特性**:让服务端把可见 island 的内容渲进首屏 HTML 的 outlet，客户端**水合**（hydrate）既有标记而非新建挂载（mount）。

**成功判据**:

- 首屏 HTML 的 outlet 内含可见 island 的真实内容（view-source 可见、可被爬虫索引）。
- 客户端水合既有 DOM，不重渲、不闪烁。
- 既有能力不回归:实例 keep-alive（detach/attach）、重载恢复（session + domRestore）照常工作。

**非目标（YAGNI）**:

- 流式 SSR（streaming）。
- 隐藏但 present 的 keep-alive 条目的预渲染 —— 它们首屏不存在，按现状在首次 reveal 时惰性挂载（`hydrate:false`）。
- 任何 UI 框架特定的水合糖 —— 框架契约保持 UI 无关（Vue/React/Svelte 通用），demo 用 Vue 验证。

## 2. 关键架构决策:outlet 置于 chrome 水合根之外

水合的真正难点:**chrome 应用（App.vue）与各 island 是相互独立的 hydration root**。
若 island 的 SSR 标记落在 App.vue 的 outlet **内部**，则 chrome 水合会跨越它并不拥有的 island DOM →
hydration 失配，且 chrome 后续重渲会清掉 island。三条路对比:

| 方案                                               | 首屏内容     | 水合安全 | 取舍                                                    |
| -------------------------------------------------- | ------------ | -------- | ------------------------------------------------------- |
| A. island 放 `<template>` 暂存，JS 再移入 outlet   | ❌ 空 outlet | ✅       | 丢失首屏/SEO 收益，等同 content-CSR                     |
| B. island 在 outlet 内，靠 Vue 容忍 vnode/DOM 失配 | ✅           | ⚠️ 脆弱  | 依赖 Vue 内部行为，且 chrome 重渲会清子节点             |
| **C. outlet 置于 chrome 水合根之外（sibling）**    | ✅           | ✅       | App.vue 缩为「纯 chrome」，outlet 成 shell 中的兄弟元素 |

**采用方案 C。** `#app` 下，chrome-root（header/tabbar 等 chrome）与 `<main data-fs-outlet>` **并列为兄弟**;
`mount` 把 chrome 应用水合到 chrome-root（其 vdom 不含 outlet）、orchestrator 独占 outlet。

- chrome 水合永不跨越 island DOM → **零失配**;chrome 重渲不触碰 outlet。
- island 内容在最终位置、首屏可见 → 保住 SSR 首屏 / SEO 收益。
- 这是 islands 框架的通行架构（shell 与 islands 是分离的 hydration root）。

**代价**:App.vue 由「chrome + outlet」缩为「chrome」，outlet 移到 shell（HTML 模板里的静态元素）。
demo 的 header + content 布局用兄弟元素 + CSS（flex/grid）即可；不影响视觉。

## 3. 分层改动

四层，依赖自下而上;**标记契约单点拥有于 core**，server 与 client 共用，杜绝漂移。

### 3.1 core —— 共享标记构造器

抽出 island 容器的标记属性为单一来源，供客户端 orchestrator 与服务端 helper 共用:

```ts
// 入参为 intent + entryKey（entryKey = sessionEntryKey(intent, params)）
export function islandContainerAttributes(
    intent: string,
    entryKey: string,
): Record<string, string> {
    return { "data-fs-entry": "", "data-fs-intent": intent, "data-fs-key": entryKey };
}
```

客户端 orchestrator 现有的 `container.setAttribute("data-fs-entry", "")` 等三处改为消费它;
服务端 helper 把它序列化为 HTML 属性串。二者由此对同一组属性/结构达成一致。

### 3.2 ssr —— 服务端 island 渲染 helper

新增（`@finesoft/ssr`，经 `front` 透出）:

```ts
// 应用提供：渲一个目标为 HTML（mountEntry 的 SSR 平行物）。返回 Promise 以容纳 Vue renderToString 等异步渲染器。
export type RenderEntry = (entry: ResolvedEntry) => string | Promise<string>;
export function renderIslandsHtml(
    snapshot: NavigationSnapshot,
    renderEntry: RenderEntry,
): Promise<string>;
```

- 遍历 `snapshot.destinations`（**所有可见目标**，split 多列时 >1），按序对每个目标:
    - 用 `islandContainerAttributes(intent, sessionEntryKey(intent, params))` 产出容器属性串。
    - 调应用 `renderEntry(entry)` 拿内层 HTML。
    - 包成 `<div data-fs-entry data-fs-intent="…" data-fs-key="…">…内层…</div>`。
- 拼接所有目标，返回 outlet **内部** 的 HTML 串。应用在 `renderApp` 里把它放入 shell 的 outlet 位置。
- `ResolvedEntry` 形状（intent / params / entryKey / page）对 server 可用 —— 复用 core 既有类型（必要时把该接口从 browser 提到 core，避免 ssr→browser 依赖）。

### 3.3 browser —— orchestrator 首次 sync 改为「收养水合」

`ResolvedEntry` 增 `readonly hydrate?: boolean`（缺省 false = 新建挂载）。

`createIslandOrchestrator` 的首次 `sync`，对每个可见目标:

- 在 `outlet` 内查找既有 `[data-fs-entry][data-fs-key="KEY"]`:
    - **命中** → 收养:复用该容器作为 island container、以 `hydrate:true` 调 `mountEntry`、`attached=true`、**不新建、不 append**（它已在最终位置）。
    - **未命中** → 现状路径:`document.createElement` + 标记 + `mountEntry`（`hydrate:false`）+ attach。
- **孤儿/失配**:outlet 内存在但不属于任何可见目标的 SSR 容器 → 丢弃（`.remove()`），不对错内容水合。
- 仅**首次** sync 走收养;后续 sync 维持既有 mount/detach/attach 生命周期不变。

### 3.4 template（vue-minimal）

- **shell 重构（方案 C）**:`index.html` / App 挂载结构调整为 chrome-root 与 `<main data-fs-outlet>` 并列;
  App.vue 缩为「纯 chrome」（header + tabbar），不再渲 outlet。
- **ssr.ts**:`renderApp` 渲 chrome + 调 `renderIslandsHtml(snapshot, renderEntry)` 注入 outlet;
  `renderEntry = (entry) => renderToString(createSSRApp(VIEWS[entry.intent], { page: entry.page }))`。
- **main.ts**:`mountEntry` 按 `entry.hydrate` 选择 `createSSRApp(view,{page,…}).mount(container)`（水合）
  vs 现有 `createApp(view,{page,…}).mount(container)`（新建）;chrome 水合到 chrome-root。

## 4. 数据流

```
SSR:
  resolve 可见目标（已预取 page）
    → renderApp: 渲 chrome + renderIslandsHtml(snapshot, renderEntry) 注入 outlet
    → HTML：outlet 内含各 island 内容（带 data-fs-* 标记）+ PrefetchedIntents 脚本

客户端:
  chrome 水合到 chrome-root（outlet 在根外 → 干净，无失配）
    → orchestrator 首次 sync：收养 outlet 内 SSR 容器，用同一份 prefetched page 水合各 island（hydrate:true）
    → domRestore（若启用）：水合后 catch-up 回填表单/滚动（既有逻辑不变）
```

首屏 island 复用 SSR 预取的 page（`PrefetchedIntents`），水合的 props 与服务端一致 → 无 props 失配。

## 5. 测试

- **core**:`islandContainerAttributes` 返回的属性集（client 设入元素 / server 序列化）一致。
- **ssr**:`renderIslandsHtml` —— 单目标、多目标（split 顺序）、容器标记/嵌套正确、`renderEntry` 被按序调用。
- **browser orchestrator**:
    - 首次 sync 命中既有标记 → 收养（不新建元素、`mountEntry` 收到 `hydrate:true`、容器复用、attached）。
    - 无标记 → 回退新建（`hydrate:false`，与现状一致）。
    - 孤儿标记 → 丢弃。
    - 后续 sync（detach/attach/teardown）与重排不受首次收养影响。
- **E2E（playwright，vue-minimal）**:
    - view-source / 首个响应 HTML 的 outlet 内含 island 内容（非空）。
    - 客户端水合无重渲闪烁（island DOM 节点身份保持）。
    - keep-alive（tab 往返保活）、重载恢复（深链重载回填 note）仍 ✓（不回归）。

## 6. 风险与 spike

方案 C 是已知稳妥模式，但实现**第一步先做最小 spike** 去风险:

- 验证 Vue `createSSRApp(view, { page }).mount(ssrDiv)` 对服务端 island 标记的水合（无 mismatch 警告、节点复用）。
- 验证 sibling-outlet shell 下 chrome 应用的干净水合（chrome 根不含 outlet）。
- 验证收养后 orchestrator 后续 detach/attach 对「被水合的容器」行为正常。

spike 通过再铺开全特性;若 Vue 水合有意外（如 `renderToString` 注水标记与 `createSSRApp` 期望不符），
在 spike 阶段就地调整方案（不影响 core/ssr 的 UI 无关契约）。

## 7. 影响面小结

| 包                      | 改动                                                                       | 契约变化             |
| ----------------------- | -------------------------------------------------------------------------- | -------------------- |
| `core`                  | 新增 `islandContainerAttributes`;`ResolvedEntry` 提到 core 并加 `hydrate?` | 纯附加               |
| `ssr`                   | 新增 `renderIslandsHtml` + `RenderEntry` 类型                              | 纯附加               |
| `browser`               | orchestrator 首次 sync 收养水合;`ResolvedEntry.hydrate`                    | 纯附加，缺省行为不变 |
| `front`                 | 透出 `renderIslandsHtml` / `islandContainerAttributes`                     | 纯附加               |
| `templates/vue-minimal` | shell 重构（outlet 出 chrome 根）、ssr.ts、main.ts                         | demo 改动            |

无破坏性变更:不提供 `renderEntry` / 无 SSR island 标记的应用，orchestrator 全部走现状新建路径，行为字节级不变。
