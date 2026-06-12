# 结构化导航容器（Navigation Containers）设计

- **日期**：2026-06-11
- **状态**：已实现，已并入主干（`vp check` / `vp test` 全绿）
- **影响包**：`@finesoft/core`（主要）、`@finesoft/browser`、`@finesoft/ssr`、`@finesoft/front`（导出面）；`@finesoft/server` 零改动
- **相关源**：`packages/core/src/navigation/*`、`packages/core/src/bootstrap/define-navigation.ts`、`packages/browser/src/navigation-bridge.ts`、`packages/browser/src/start-app.ts`、`packages/ssr/src/navigation.ts`

---

## 1. 背景与动机

框架当前的请求生命周期是**扁平单页**的：`Router.resolve(url)` → 一个 intent → 一个 controller → 一个 `Page`。这对「一屏一页」的应用足够，但对原生 App 式的多区域导航无能为力：

- **导航栈**（SwiftUI `NavigationStack`）：一条有序路径，push 进入详情、pop 返回，根 entry 不可弹出。
- **标签容器**（`TabView`）：并列分支各自独立、仅激活分支可见，切 tab 不丢其它分支的栈深。
- **分栏**（`NavigationSplitView`）：多列同屏，左列选择驱动右列内容，列与列可同时可见。

这些结构有共同的形态：**可递归组合**（tabs 的每个分支是一个 stack；split 的 detail 列又是一个 stack），且需要在 URL / history / SSR 之间一致地往返。

关键约束：框架**内容无关**。它只应拥有导航的「状态 + 语义 + URL/history/SSR 集成」，**不含任何 UI**。`Page` 保持 `unknown` 语义（运行期是 `BasePage`，字段含义由应用决定），应用用 Svelte / React / Vue 任意渲染。

---

## 2. 目标 / 非目标

### 目标

1. **递归导航树模型**：用可辨识联合表达 stack / tabs / split 的任意嵌套组合。
2. **纯、不可变的操作**：push/pop/selectTab/selectColumn 等返回带结构共享的新树，便于 diff、撤销、序列化。
3. **复刻现有生命周期**：每个可见目标走与扁平 runner **完全相同**的 `beforeLoad → dispatch → afterLoad` 语义（guard 的 redirect/rewrite/deny 行为一致）。
4. **URL / history / SSR 集成**：可插拔 codec 决定 URL 形态；history 桥接 push/replace/popstate；SSR 预取**所有**可见目标并经既有 hydration 通道还给浏览器。
5. **完全向后兼容**：单个 `LeafNode` 树 **逐位等价**于今天的扁平单页；不使用导航的应用零行为变化。
6. **声明式入口**：`defineNavigation(...)` 与 `defineRoutes(...)` 并列，单次声明同时适配 CSR / SSR runner。

### 非目标（本版不做）

- **不提供任何 UI 组件 / 渲染器**：框架只给状态与快照，渲染是应用的事。
- **不做转场动画 / 手势**：纯属表现层。
- **不做跨树的「全局返回栈」抽象**：返回语义由浏览器 history 提供，树本身不持有线性历史。
- **不内置持久化**（localStorage 等）：序列化原语已给出，落盘策略交给应用。
- **非主目标不跑 guard**：守卫只对「主目标」（激活叶子）执行，与现有 runner 一致（见决策 4）。

---

## 3. 核心设计

### 3.1 四节点模型（可辨识联合）

导航状态是一棵 `NavigationNode` 树。`kind` 是判别字段，常量集中在 `NAVIGATION_NODE_KINDS`：

```ts
export const NAVIGATION_NODE_KINDS = {
    LEAF: "leaf",
    STACK: "stack",
    TABS: "tabs",
    SPLIT: "split",
} as const;
```

| 节点        | 字段                                                                                     | 语义                                                                                 | 对标 SwiftUI          |
| ----------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------- |
| `LeafNode`  | `intent: string`、`params: RouteParams`                                                  | 一个具体导航目标（一次 intent 派发）                                                 | 一个 destination view |
| `StackNode` | `entries: readonly NavigationNode[]`                                                     | 有序路径：`entries[0]`=根，末尾=栈顶（可见）；绝不弹到根下                           | `NavigationStack`     |
| `TabsNode`  | `active: string`、`order: readonly string[]`、`branches: Record<string, NavigationNode>` | 并列分支 + 激活键 + 稳定顺序；**仅激活分支可见**                                     | `TabView`             |
| `SplitNode` | `columns: readonly SplitColumn[]`（`{ id, content? }`）、可选 `visibility`               | 多列并存，列间靠 `selectColumn` 设后续列内容；可见集默认全列、可经 `visibility` 收窄 | `NavigationSplitView` |

所有节点字段 `readonly`。`NavigationNode = LeafNode | StackNode | TabsNode | SplitNode`。

**为何 leaf 是 intent + params 而非 Page**：导航树是**纯数据 / 可序列化**的。把 `Page`（运行期对象）放进树会让它无法稳定 stringify、无法进 URL。树只描述「要去哪」（intent + params），「那里是什么」（Page）由 controller 在解析时产出，并随快照分发。

### 3.2 组合性：递归即组合

内部节点的 child 又是 `NavigationNode`，因此组合天然递归，与 SwiftUI 一致：

```ts
// TabView，每个 tab 是一个 NavigationStack
tabs({
    active: "home",
    branches: {
        home: stack(leaf("home")),
        search: stack([leaf("search"), leaf("results")]), // 已 push 了一层
        me: stack(leaf("me")),
    },
});

// NavigationSplitView：sidebar + detail，detail 列是一个 stack
split([
    { id: "sidebar", content: leaf("folders") },
    { id: "detail", content: stack(leaf("folder", { id: "inbox" })) },
]);
```

构造器（`packages/core/src/navigation/nodes.ts`）产出冻结的不可变节点；`tabs` 缺省 `order` 时按 `branches` 插入顺序推导；`stack` 接受「单根节点」或「entries 数组」两种入参。守卫 `isLeafNode` / `isStackNode` / `isTabsNode` / `isSplitNode` 做窄化。

### 3.3 路径与激活路径

定位树中某节点用 `NavigationPath`（从根到目标的步骤序列）：

```ts
type NavigationPathStep =
    | { kind: "stack-entry"; index: number }
    | { kind: "tab"; key: string }
    | { kind: "column"; id: string };
```

**激活路径**（`resolveActivePath`）从根沿「可见分支」一路下钻：stack 进栈顶 entry、tabs 进 active 分支、split 进最后一个非空列，直到叶子或无法继续。这条路径定义了「用户当前聚焦的目标」，是两件事的默认锚点：

- 省略 `target` 的栈操作默认作用于激活路径上**最深**的 stack（`findActiveStack`）。
- 省略 `target` 的 `selectTab` / `selectColumn` 默认作用于激活路径上**最外层**的 tabs / split（`findActiveKind`）——「主标签栏 / 主分栏」；要操作更深的容器须显式传 `target`。

`findNode(tree, path)` 按路径取节点（任一步无效返回 `undefined`）；`findNearestStack(tree, path)` 从 target 处向下找第一个 StackNode。

### 3.4 纯操作（不可变 + 结构共享）

`packages/core/src/navigation/operations.ts` 全是纯函数：不改输入，仅重建被改动路径上的节点，其余子树原样复用。变换内核 `transformAt(tree, path, mapper)` 沿 path 重建到目标节点再应用 `mapper`，任一步类型不匹配 / 越界抛 `NavigationError`。

| 操作                                             | 作用                                                          |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `push(tree, node, target?)`                      | 在目标栈（默认激活栈）顶 push                                 |
| `pop(tree, count?, target?)`                     | 弹出 count 个（默认 1）；**绝不弹到根 entry 之下**            |
| `popTo(tree, index, target?)`                    | 弹回到指定 index（保留 `[0..index]`）                         |
| `popToRoot(tree, target?)`                       | 弹回根 entry                                                  |
| `replaceTop(tree, node, target?)`                | 替换栈顶 entry（栈空抛错）                                    |
| `selectTab(tree, key, target?)`                  | 切换 tabs 激活分支（非 tabs / 未知 key 抛错）                 |
| `selectColumn(tree, columnId, content, target?)` | 设 split 列内容，**并清空其后所有列**（content 置 undefined） |
| `setVisibility(tree, visibility, target?)`       | 设 split 列可见性（非 split 抛错）                            |

查询：`collectVisibleDestinations` / `visibleSplitColumns` / `resolveActivePath` / `findNode` / `findNearestStack`。

**`selectColumn` 清空后续列**是分栏的关键语义：换 sidebar 选择应当作废已打开的 detail（leaf → detail → subdetail 这条 split 链上，重选第 1 列让第 2、3 列归空），避免出现「旧 detail 配新 sidebar」的不一致。

### 3.5 可见目标与 SSR 的关系

`collectVisibleDestinations(tree)` 是连接「树」与「渲染 / 预取」的桥：

- `leaf` → `[leaf]`
- `stack` → 栈顶 entry 的可见目标
- `tabs` → **仅** active 分支的可见目标
- `split` → 经 `visibility` 裁剪后的**每个可见非空列**的可见目标，按列序拼接

关键差异：**tabs 只贡献激活分支**（隐藏 tab 不预取），**split 贡献可见列**（多列同屏要同时有数据）。这直接决定 SSR 预取多少个 intent —— split 视图天然产出多个 `ResolvedDestination`。

#### 3.5.1 列可见性（`SplitVisibility`）

对标 SwiftUI `NavigationSplitViewVisibility`：`SplitNode.visibility?` 是**可绑定 / 可序列化 / 可恢复的导航状态**（非渲染样式），决定哪些列算可见，从而裁剪 `collectVisibleDestinations` 与 SSR 预取：

- `automatic`（缺省，不写字段）/ `all` → 全部列（与既有行为一致，向后兼容）
- `doubleColumn` → 首列 + 末列（三列时隐藏中间 content 列）
- `detailOnly` → 仅末列（detail）

辅助 `visibleSplitColumns(node)` 把该映射暴露给应用渲染层；`setVisibility` 操作 + `controller.setVisibility()` 让运行时切换可见性时**新变可见的列被 dispatch、隐藏列从快照移除**。这样「深链到 `detailOnly`」在服务端只解析/预取 detail 列。`automatic` 在 SSR 无视口信息时按「全列」安全默认（客户端再自适应）。

**显式非目标**：compact 视口塌缩成单栈（SwiftUI `preferredCompactColumn`）是视口反应式的纯渲染决策，框架不建模，由应用按 `getPlatform()` / 视口自行处理。

### 3.6 序列化

`packages/core/src/navigation/serialization.ts`：

- `serializeNavigation(tree)` → JSON-safe 纯对象 `SerializedNavigation`（`SplitColumn.content` 的 `undefined` 落为 `null`）。
- `serializeNavigationStable(tree)` → **稳定字符串**（key 排序，复用 `prefetched-intents/stable-stringify`），相同树产出相同串，供缓存键 / URL 编码使用。
- `deserializeNavigation(data)` → `NavigationNode`，校验结构，畸形输入抛 `NavigationError`。往返无损。

### 3.7 Codec：URL ⇄ 树

`NavigationCodec` 把树与 URL 互转，只依赖 Router 的最小读取面 `NavigationRouterLike`（`getRoutes()` + 可选 `reverse()`），避免与 Router 实现耦合：

```ts
interface NavigationCodec {
    encode(tree: NavigationNode, router: NavigationRouterLike): string;
    decode(url: string, router: NavigationRouterLike): NavigationNode | undefined;
}
```

两种内置策略：

| Codec                           | URL 形态                                       | encode                                       | decode                                                       |
| ------------------------------- | ---------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| `createActiveLeafCodec`（默认） | 干净 URL，只反映**激活叶子**（`/products/42`） | 把激活叶子反查为路径（`reverse` 或路由摘要） | 仅当 URL 带 `__nav` 覆盖时同步还原整树；否则返回 `undefined` |
| `createFullStateCodec`          | 整树编进保留 query 参数（默认 `__nav=...`）    | 激活叶子 URL 为基底 + 写入整树编码           | 读保留参数无损还原整树；缺失则 `undefined`                   |

**为何默认 codec 的 `decode` 在无覆盖时返回 `undefined`**：`Router.resolve` 是异步的（typed-route-params 设计后），而 `decode` 契约为同步。所以默认 codec 把「URL → 单 LeafNode」这条**异步**重建交给调用方走 `await router.resolve(url)`（含参数校验）—— 与现有 SSR/CSR runner 完全一致。仅 `__nav` 覆盖这条**纯结构、可同步**还原的路径才在 `decode` 内完成。

整树编码 `encodeNavigationTreeParam` = `stableStringify(serialize(tree))` → base64url（无 padding，UTF-8 安全，优先平台原生 `btoa`/`TextEncoder`，回退手工实现以跨 SSR/CSR 一致）。`decodeNavigationTreeParam` 逆向，畸形抛 `NavigationError`。开发者可实现自定义 `NavigationCodec`。

### 3.8 NavigationController 生命周期

`createNavigationController(options)`（`packages/core/src/navigation/controller.ts`）把纯树接到框架生命周期。它**不持有 UI、不碰 history/URL**（那是 bridge / ssr 的活），只负责：用 operations 算下一棵树 → 解析所有可见目标 → 跑主目标守卫 → 提交快照 → 通知订阅者。

```ts
interface NavigationControllerOptions {
    intentDispatcher: IntentDispatcher;
    router: Router;
    initial: NavigationNode;
    createContext: (input: NavigationContextInput) => NavigationDispatchContext;
    beforeLoad?: readonly BeforeLoadGuard[];
    afterLoad?: readonly AfterLoadGuard[];
    prefetched?: PrefetchedIntents;
    getErrorPage?: (status: number, message: string) => Page;
    onRedirect?: (redirect: { url: string; status: number }) => void;
}
```

`createContext` 由应用提供：给定目标 intent/params，返回派发用的 `container` + 守卫用的 `navigation`（`NavigationContext`）。仓库里没有契约假设的 `IntentContext`——dispatch 需要 `Container`，守卫需要 `NavigationContext`，所以拆成这两件。SSR 侧用 `createServerContext`（含请求 cookie/header）、CSR 侧用 `createBrowserContext`（读 `document.cookie`）填充。

**`apply(op)` 的步骤**（对标 SSR `ssrRenderInternal` 与浏览器 `navigateTo`）：

1. **算下一棵树**：`computeNextTree(op)` 用对应纯操作得到 `nextTree`。
2. **解析可见目标**：`collectVisibleDestinations(nextTree)`，与上一快照按 **`intent + stableStringify(params)`** 身份键 diff。
3. **主目标 = 激活叶子**：跑 `beforeLoad`；处理结果——
    - `next` → 继续；
    - `redirect` → 调 `onRedirect`，本目标不 dispatch；
    - `rewrite` → 用新 URL `await router.resolve` 重解析成 leaf，替换主目标 intent/params（不复用旧页）；
    - `deny` → 打 deny status，不 dispatch。
4. **派发**：仅对**新出现**的目标 `intentDispatcher.dispatch`；未变目标复用上一快照的 page；命中 `prefetched`（SSR 预取）时复用，不回服务端。**单个目标 dispatch 失败不抛出 `apply`**——记 status=500 + `getErrorPage` 兜底页（复刻 controller 的 fallback）。
5. **主目标 `afterLoad`**：数据已在，rewrite 仅记 canonical URL（不重跑）；redirect/deny 与 before 对称。
6. **提交**：`{ tree, destinations }`（destinations 顺序与 `collectVisibleDestinations(next)` 一致）→ 通知订阅者。

便捷方法 `push/pop/popToRoot/replaceTop/selectTab/selectColumn/hydrate` 都是 `apply` 的薄封装；`resolve()` 对当前树做首屏解析（首次以空快照为基线）。`subscribe` 注册快照监听。

**单 LeafNode 树 = 扁平单页**：一个可见目标、一次 resolve/dispatch、一对 before/after —— 逐位等价于今天。

---

## 4. 关键决策记录

| #   | 决策              | 选择                                                | 理由                                                                                         |
| --- | ----------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | 模型              | 递归可辨识联合（4 节点）                            | 直接映射 SwiftUI 三容器 + 任意嵌套；纯数据可序列化                                           |
| 2   | leaf 内容         | intent + params，**非** Page                        | 树要可稳定 stringify / 进 URL；Page 是运行期对象，解析时才产出                               |
| 3   | 操作              | 纯函数 + 结构共享                                   | 便于 diff / 撤销 / 序列化；与「不可变上下文」既有风格一致                                    |
| 4   | guard 范围        | **仅主目标**（激活叶子）跑 before/after             | 复刻现有 runner（守卫只跑当前导航的目标）；非主目标只 dispatch，零语义漂移                   |
| 5   | dispatch 失败     | 不抛出 `apply`，记 status + 兜底页                  | 复刻 controller `fallback`；一个 split 列失败不该炸掉整屏                                    |
| 6   | 默认 codec decode | 无 `__nav` 覆盖 → 返回 `undefined`                  | `Router.resolve` 异步、`decode` 同步；异步重建交回调用方，与现有 runner 一致                 |
| 7   | URL 默认形态      | 激活叶子（干净 URL），整树走 history/hydration 旁路 | 多数应用要可分享的干净 URL；深链需求用 `createFullStateCodec` 显式启用                       |
| 8   | SSR 预取          | 复用既有 `PrefetchedIntents` + 哨兵条目             | `@finesoft/server` 零改动即可透传；浏览器用现有 hydration 还原                               |
| 9   | 声明入口          | `defineNavigation` 产出定义 + 两个 adapter          | 单次声明，`toBrowserConfig()` / `toSSRDefinition()` 各取所需，避免 core→browser/ssr 反向依赖 |

---

## 5. 浏览器集成（`@finesoft/browser`）

`packages/browser/src/navigation-bridge.ts` 的 `createNavigationBridge(deps)` 把 controller 落到 History：

- **快照 → history**：订阅 controller，快照变更时用 `serializeNavigation(tree)` 作为 HistoryState、`codec.encode(tree, router)` 作为地址栏 URL。首屏 / 同 URL 用 `replaceState`，否则 `pushState`（对齐 FlowAction handler 的 first-page 语义）。
- **popstate → controller**：优先从 History 缓存读回整树（`deserializeNavigation`），未命中（硬刷新 / 超 LRU 容量的深层 entry）回退 `codec.decode(url, router)`；再 `controller.hydrate(tree)`。默认 codec 对无 `__nav` 的 URL 返回 `undefined` 时，保留当前树不动（避免误清空）。
- **`isApplyingHistory` 闸门**：popstate 触发的 `hydrate` 会回调订阅器，但**不可**再写 history（否则制造冗余 entry / 循环）。只有「来自应用操作的提交」写 history。
- **navigation handle**：向应用暴露 `push/pop/popToRoot/replaceTop/selectTab/selectColumn` + `getSnapshot/subscribe/hydrate`。

`startBrowserApp` 新增可选 `navigation?: BrowserNavigationConfig` + `onNavigationReady?(handle)`。仅当提供 `navigation` 时 `activateNavigation` 才构建 controller（守卫上下文走 `createBrowserContext`，`prefetched: framework.prefetchedIntents`，`onRedirect` → `framework.perform(makeFlowAction(url))` 复用 FlowAction 管线）+ bridge，`resolve()` 首屏后把 handle 交给 `onNavigationReady`。**缺省时走原有扁平单页路径，行为完全不变。**

---

## 6. SSR 集成（`@finesoft/ssr`）

`packages/ssr/src/navigation.ts` 的 `ssrRenderNavigation(options)` / `createSSRNavigationRender(config)`：

1. **URL → 初始树**（`resolveInitialTree`，三级回退）：
    - `codec.decode(url)` 带 `__nav` 覆盖 → 整树（深链）；
    - `navigation.initial(url)` → 应用提供的默认结构骨架（如默认两列 split）；
    - `Router.resolve(url)` → 单 LeafNode（今天的扁平单页，一并拿 `renderMode`）；
    - 全失败 → `undefined` → 404 单页（与单页 SSR 的 404 路径对齐）。仅第 3 步回填 `renderMode`，单页路径的 renderMode 与今天一致。
2. **构建 controller + `resolve()`**：一次性预取**所有**可见目标（split 多列 → 多个 `ResolvedDestination`）。守卫上下文走 `createServerContext`（含 cookie/header），不传 `prefetched`（SSR 是「生产」预取数据的一侧）。
3. **序列化进 HTML**：经**既有 `PrefetchedIntents` 通道**——每个可见目标产出一条 `{ intent, data: page }`（与单页 SSR 完全一致），再追加一条**哨兵条目** `{ intent: { id: NAVIGATION_TREE_INTENT_ID }, data: payload }` 承载 `serializeNavigation(tree)`（用 `markPublic(..., true)` 标记全字段公开，绕开白名单裁剪）。哨兵复用同一个 `#serialized-server-data` 脚本，故 `@finesoft/server` **零改动**透传。

浏览器侧 `extractNavigationTree(serverData)` 取出树、`stripNavigationTree(serverData)` 剔哨兵，剩下的纯目标条目交给现有 `PrefetchedIntents.fromArray`，每个目标按 `stableStringify(intent)` 命中、controller dispatch 优先复用，不再回服务端取数。

`renderApp(page, framework, snapshot)` 第一参数是「主目标」页（与单页 SSR 的 `renderApp` 形态兼容），第三参数是完整多区域快照，应用据此渲染 tabs / split 布局。**应用不传 `navigation` 时调用方继续走 `ssrRender` 单页路径**；本模块对单 LeafNode 树与单页 SSR 等价（仅 `serverData` 多一条树哨兵）。

---

## 7. 声明入口（`@finesoft/core/bootstrap`）

`defineNavigation(options)`（`packages/core/src/bootstrap/define-navigation.ts`）与 `defineRoutes` 并列，单次声明导航结构，产出规范化的 `NavigationDefinition`：

- `initial: NavigationNode | ((url) => NavigationNode | undefined)` —— 静态树或按 URL 产出骨架的工厂。
- `toBrowserConfig(url?)` → `BrowserNavigationConfig`（`initial` 收敛为具体树；工厂返回 `undefined` 时回退占位根 leaf `@finesoft/navigation-root`，随后由 SSR 注入的真实树 hydrate）。
- `toSSRDefinition()` → `SSRNavigationDefinition`（`initial` 收敛为骨架工厂、`codec` 必填；不含 `getErrorPage`——SSR runner 自带）。

`defineNavigation` 本身**不绑定 Framework 实例、不改路由表**，只把声明规范化为定义对象 + 两个 adapter。它是为了让应用「只声明一次」，由 adapter 适配出 CSR / SSR runner 各自需要的精确形态，并避免 core → browser/ssr 的反向依赖。完全可选、纯附加。

---

## 8. 向后兼容性

- **不使用导航的应用**：`startBrowserApp` / `createSSRRender` 不传 `navigation` → 走原扁平单页路径，**零行为变化**。
- **单 LeafNode 树**：逐位等价扁平单页——一个可见目标、一次 resolve/dispatch、一对 before/after；SSR 仅 `serverData` 多一条哨兵条目（被 `stripNavigationTree` 剔除，不进 `PrefetchedIntents`）。
- **`@finesoft/server` 零改动**：哨兵复用既有 `#serialized-server-data` 通道。
- **导出面**：core 导航 API 经 `export * from "@finesoft/core"` 自动进 `front`；browser/ssr 的导航符号显式加入 `front` 的 index / browser 入口（SSR 符号不进 browser 入口）。这是 minor（纯新增）。

---

## 9. 测试策略

| 层                 | 覆盖                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 节点 / 守卫        | 构造器规范化（order 推导、stack 双形态入参）、`is*Node` 窄化                                                                                      |
| 操作               | 每个操作的 happy path + 边界（pop 不越根、popTo 越界抛错、selectColumn 清后续列）+ 结构共享（未改子树引用不变）+ 非法 target 抛 `NavigationError` |
| 查询               | `resolveActivePath` 各组合、`collectVisibleDestinations`（tabs 仅激活 / split 全列）、`findNode` / `findNearestStack`                             |
| 序列化             | 往返无损、`undefined ⇄ null` 列内容、`serializeNavigationStable` 稳定性、畸形输入抛错                                                             |
| codec              | active-leaf encode（reverse / 路由摘要回退）、full-state 往返、`__nav` 覆盖 decode、base64url UTF-8                                               |
| controller         | 主目标守卫（redirect/rewrite/deny）、未变目标复用、prefetched 复用、dispatch 失败兜底、订阅通知、单 leaf ≡ 单页                                   |
| `defineNavigation` | 规范化、两 adapter、工厂 / 静态树、undefined 回退、单 leaf ≡ 扁平单页等价（12 测试）                                                              |
| 浏览器 bridge      | 快照 → push/replace、popstate 缓存命中 / codec 回退、`isApplyingHistory` 不回写 history                                                           |
| SSR                | 三级初始树回退、多列预取多目标、哨兵 extract/strip、单页等价、404 / csr / redirect 短路                                                           |

实现态：`vp check` 178 文件全过；`vp test` 73 文件 / 535 测试全过，零既有回归。

---

## 10. 改动清单（按包）

### `@finesoft/core`（主要，新增 `src/navigation/`）

- `types.ts`：4 节点接口 + `NavigationPath` / `ResolvedDestination` / `NavigationSnapshot` / `NavigationError` + `NAVIGATION_NODE_KINDS`。
- `nodes.ts`：`leaf` / `stack` / `tabs` / `split` + `is*Node` + `TabsInit` / `SplitColumnInit`。
- `operations.ts`：纯操作 + 查询。
- `serialization.ts`：`serializeNavigation` / `serializeNavigationStable` / `deserializeNavigation` + `Serialized*` 类型。
- `codec.ts`：`NavigationCodec` / `NavigationRouterLike` + `createActiveLeafCodec` / `createFullStateCodec` + 树参数编解码 + `DEFAULT_NAV_PARAM`。
- `controller.ts`：`createNavigationController` + `NavigationOperation` 联合 + `NAVIGATION_OP_KINDS` + 上下文类型。
- `index.ts`（barrel）→ `src/index.ts`：导出全部导航符号；`bootstrap/define-navigation.ts` → `src/index.ts` Bootstrap 块。

### `@finesoft/browser`

- `navigation-bridge.ts`（新增）：`createNavigationBridge` + `NavigationHandle` / `NavigationBridgeDependencies`。
- `start-app.ts`：`BrowserNavigationConfig` + 可选 `navigation` / `onNavigationReady` + `activateNavigation`。

### `@finesoft/ssr`

- `navigation.ts`（新增）：`ssrRenderNavigation` / `createSSRNavigationRender` + `extractNavigationTree` / `stripNavigationTree` + `NAVIGATION_TREE_INTENT_ID` + 相关类型。

### `@finesoft/server`

- **零改动**（哨兵复用既有 `#serialized-server-data` 通道）。

### `@finesoft/front`

- index / browser 入口加入 browser + ssr 的导航符号（core 经 `export *` 自动透传）。

---

## 11. 开放问题 / 未来增强

- **持久化 helper**：把整树存 localStorage / IndexedDB 的开箱原语（当前已有序列化原语，需应用自接）。
- **批量操作**：单次 `apply` 跑一组操作（如「selectTab + push」）只触发一次解析 / 一次 history 写。
- **非主目标的 guard 选项**：可选开关让所有可见目标都跑守卫（默认仍仅主目标）。
- **过期目标的 page GC**：当前未变目标无限复用上一快照页；超大树可考虑 LRU 限制复用集合。
- **`order` 变更动画 hook**：树 diff 已足够支撑，留给应用层。
