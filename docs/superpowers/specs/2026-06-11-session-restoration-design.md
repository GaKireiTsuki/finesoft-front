# 会话恢复（Session Restoration）设计

> 状态：已批准设计，待评审 spec。
> 依赖：结构化导航特性（`feat/navigation-containers`，PR #23）——结构化导航适配器引用其 `SerializedNavigation` / `NavigationController`。

## 1. 背景与动机

框架已能恢复**首屏**：SSR 把 prefetch 的 intent 结果经 `PrefetchedIntents` 注入 HTML，浏览器还原、首次导航复用服务端结果。结构化导航的当前树也会随 `history.state`（内存 LruMap）走前进后退。

但有一类状态今天**恢复不了**：用户**硬重载 / 标签崩溃 / 关掉再回来**之后「当时在干什么」——他在哪一页（或哪个栈深 / 哪个 tab / split 哪一列）、表单里打了一半的草稿、列表滚到哪、哪些面板展开着。`history.state` 的内存 LruMap 在整页重载后即清空，`PrefetchedIntents` 只覆盖服务端渲染的那一屏，都不持久。

**会话恢复**填这个缺口：把一份**可序列化的会话快照**（导航位置 + 应用注册的状态切片）**持久化**到可插拔存储，并在**全新加载**时重水化，恢复用户在进行中的状态。框架不参与 UI——它只恢复**状态**，应用据此自行重渲染。

## 2. 目标 / 非目标

### 目标

1. **会话快照模型**：可序列化、带版本、JSON 安全地捕获「导航位置 + 应用状态切片」。
2. **可插拔持久化**：复用现有 `Storage`（`DEP_KEYS.STORAGE`）；浏览器默认 `sessionStorage`，应用可换 `localStorage` / 服务端 Storage。
3. **应用状态切片**：应用注册 `SessionStateProvider`（`capture()` / `restore()`），框架编排时机与持久化；UI 无关。
4. **覆盖扁平与结构化导航**：经小适配器接口 `SessionNavigationAdapter` 解耦，同一套机制覆盖单页 URL 与导航树。
5. **自动 + 手动**：导航变更防抖 + `pagehide`/`visibilitychange` 自动捕获、boot 自动恢复；同时暴露 `save()` / `clear()` 手动逃生口。
6. **健壮**：版本/过期/畸形快照丢弃不崩；单 provider 抛错隔离；Storage 配额错吞掉。
7. **纯附加 + 向后兼容**：不配 `session` 时行为字节级不变。

### 非目标（本版不做）

- **服务端持久化的内建适配器**：可插拔 `Storage` 已让应用用「服务端同步的 Storage」实现跨设备，但框架 v1 不内建服务端端点。
- **多命名会话 / 会话管理器**：单 key（应用可自定义 / 按用户命名空间）。不做 session 列表 UI / 切换。
- **冲突合并 / CRDT**：恢复是「整份快照覆盖」，不做字段级合并。
- **自动捕获任意 DOM 态**：框架不扫描 DOM；状态切片由应用显式 `capture()` 提供。

## 3. 核心设计

### 3.1 数据模型

```ts
/** 会话快照：用户「当时在干什么」的可序列化捕获。 */
interface SessionSnapshot {
    readonly version: number;
    /** 导航位置：结构化 → SerializedNavigation；扁平 → { url } */
    readonly navigation?: SerializedNavigation | SessionUrlLocation;
    /** 全局切片（app-wide）：provider.key → 该 provider capture() 的 JSON 值 */
    readonly slices: Readonly<Record<string, unknown>>;
    /** 导航作用域状态：entryKey → 该导航条目的状态袋；条目离树即被 prune 丢弃 */
    readonly scoped: Readonly<Record<string, unknown>>;
    /** 捕获时刻（epoch ms）；用于 maxAgeMs 过期判断 */
    readonly capturedAt: number;
}
interface SessionUrlLocation {
    readonly url: string;
}
```

`navigation` 用一个轻判别：`SerializedNavigation` 自带 `kind`（leaf/stack/tabs/split），`SessionUrlLocation` 用独有的 `url` 字段——`isUrlLocation(nav)` 守卫区分。

### 3.2 状态切片 Provider

```ts
interface SessionStateProvider<T = unknown> {
    /** 切片唯一键（快照里 slices 的 key）。 */
    readonly key: string;
    /** 捕获当前切片状态，必须返回 JSON 安全的同步值。 */
    capture(): T;
    /** 用持久化的切片数据恢复（应用自行 setState / 填表单 / 滚动）。 */
    restore(data: T): void;
}
```

同步、JSON 安全。框架不解释切片内容——它只搬运。应用控制捕获什么（敏感字段在此自行排除）。

### 3.2.1 两种状态作用域：全局切片 vs 导航作用域

会话恢复区分两层作用域，二者共同序列化进快照、一起跨重载恢复：

- **全局切片（§3.2，`slices`）**：app-wide，生命周期 = 整个会话（主题、跨屏向导草稿…）。键 = `provider.key`。
- **导航作用域状态（`scoped`）**：**绑定到某个导航条目**，对标 SwiftUI 视图 `@State` 的「位置作用域」语义——

    > `A` → push `B` → 返回（pop `B`）到 `A`：**`B` 的状态丢弃，`A` 的状态仍在**。

    机制：状态按**条目身份键** `entryKey = intent + " " + stableStringify(params)`（与 controller 的 `destinationKey` 同源、跨重载稳定）存入 `Map<entryKey, 状态袋>`。每次导航提交后，框架按**树中实际存在的全部条目**（注意是「存在」而非「可见」）prune——身份不在树里的条目状态被丢弃：
    - push `B`：树 `[A, B]`，present `{A, B}` → `A` 状态保留（`A` 仍在栈、只是不可见），`B` 拿到自己的作用域。
    - pop `B`：树 `[A]`，present `{A}` → **`B` 的作用域被 prune 丢弃**，`A` 的原样保留；返回 `A` 按保留态渲染。
    - TabView 切 tab：其它分支仍在树中 → 其状态保留（与 SwiftUI tab 保活一致）。
    - 跨重载：`scoped` 随快照序列化；重载后每个仍在树的条目恢复各自作用域，之后 pop 照常丢弃。

    **扁平 vs 结构化**：上面的「A 留在 B 底下、pop 回 A 保留」**栈式保留**语义**本质上就是栈**，因而只在**结构化导航**（栈/树有「present 但不 visible」的条目）成立。**扁平单页没有栈**——A→B 是整页替换，`presentKeys()` 恒为单条目（当前 URL），所以一离开某屏其作用域即被 prune、浏览器返回是 fresh 重渲染。两种模式都支持「当前屏作用域 + 跨重载恢复」；要「返回保留上一屏」就把它建成结构化栈（push 而非 replace）——这正是 `NavigationStack` 的意义，不是扁平模式的缺陷。

    **应用读写**：每个 `ResolvedDestination` 配套 `entryKey`（同款 `sessionEntryKey(intent, params)` 辅助）；应用渲染某屏时用它 `store.scope.get(entryKey)` / `set(entryKey, data)`。框架只搬运状态袋、不解释其形状。

    **身份取值（v1）**：内容键 `intent + stableStringify(params)`。已知局限——**同时存在的两个完全相同目标**（同 intent 同 params）会共享作用域、且仅当最后一个离树才丢弃；需严格区分时应用在 params 带区分位（未来可加显式 entry id，留接口位）。

### 3.3 SessionStore（core 编排器）

```ts
interface SessionStore {
    /** 注册全局切片 provider；返回反注册函数。 */
    register(provider: SessionStateProvider): () => void;
    /** 导航作用域状态读写 + prune（见 §3.2.1）。 */
    readonly scope: NavigationScopedState;
    /** 组装当前快照（nav + slices + scoped），不落盘。 */
    capture(): SessionSnapshot;
    /** 落盘（省略参数则先 capture）。 */
    persist(snapshot?: SessionSnapshot): void;
    /** 从 Storage 读取并校验（version/maxAge/畸形 → undefined）。 */
    load(): SessionSnapshot | undefined;
    /** 恢复：应用 nav + 回填 scoped + 派发各 slice 给对应 provider（省略则先 load）。 */
    restore(snapshot?: SessionSnapshot): void | Promise<void>;
    /** 清除持久化快照。 */
    clear(): void;
    /** 手动逃生口 = capture + persist。 */
    save(): void;
}

/** 导航作用域状态：entryKey → 状态袋；条目离树由框架 prune 丢弃。 */
interface NavigationScopedState {
    get(entryKey: string): unknown | undefined;
    set(entryKey: string, data: unknown): void;
    delete(entryKey: string): void;
    /** 仅保留 present 集中的键，丢弃其余（导航提交后由 bridge 调用）。 */
    prune(presentKeys: Iterable<string>): void;
    keys(): readonly string[];
}

/** 导航条目身份键：与 controller 的 destinationKey 同源、跨重载稳定。 */
sessionEntryKey(intent: string, params: RouteParams): string

interface SessionStoreOptions {
    readonly storage: Storage;                        // DEP_KEYS.STORAGE
    readonly key?: string;                            // 默认 SESSION_DEFAULT_KEY
    readonly version?: number;                        // 默认 1；不符即丢弃
    readonly maxAgeMs?: number;                       // 省略 = 不过期
    readonly navigation?: SessionNavigationAdapter;   // 省略 = 不恢复导航
    readonly now?: () => number;                      // 注入时钟（测试/SSR 安全）
    readonly onError?: (error: unknown, ctx: SessionErrorContext) => void;
}
createSessionStore(options: SessionStoreOptions): SessionStore
```

- **编排**：`capture()` 调 `navigation?.capture()` + 遍历 providers 收 `slices` + 快照 `scope` 当前的 `scoped` map；`restore()` 先 `navigation?.apply()`、再回填 `scope`（scoped map）、再按 key 把 slice 派回 provider。`scope` 的 prune 不在 store 内部自动触发——由 bridge 在导航提交后用 `adapter.presentKeys()` 调（core 不订阅导航）。
- **校验**：`load()` 解码 → 校验 `version` 一致、`capturedAt` 在 `maxAgeMs` 内、结构合法；任一不符返回 `undefined`（并不自动清，留给 `clear()`/覆盖）。
- **时钟注入**：`now`（默认 `() => Date.now()`）；`capturedAt` 由它产出，测试可定值。
- **错误隔离**：provider/adapter 抛错经 `onError`（默认 no-op，应用可接 EventRecorder）上报并跳过，不中断整体。

### 3.4 导航适配器（解耦）

SessionStore 不直接依赖 NavigationController，只依赖：

```ts
interface SessionNavigationAdapter {
    /** 捕获当前导航位置。 */
    capture(): SessionSnapshot["navigation"] | undefined;
    /** 应用恢复的导航位置。 */
    apply(navigation: SessionSnapshot["navigation"]): void | Promise<void>;
    /** 树中**存在**的全部条目身份键（用于 scoped prune；「存在」非「可见」）。 */
    presentKeys(): Iterable<string>;
}
```

ship 两个 helper：

- `createNavigationSessionAdapter(controller, shouldApply?)`：结构化。`capture` = `serializeNavigation(controller.getTree())`；`apply` = `controller.hydrate(deserializeNavigation(nav))`（nav 是 URL 形态则降级为单 leaf）；`presentKeys` = 遍历 `controller.getTree()` 收集**全部 leaf**（含不可见的 A、未激活分支）→ `sessionEntryKey(intent, params)`。需要一个全树 leaf 遍历（session 层自带 `collectLeafKeys(tree)`，不改导航包）。
- `createUrlSessionAdapter({ currentUrl, navigate })`：扁平。`capture` = `{ url: currentUrl() }`；`apply` = `navigate(nav.url)`（应用提供 `framework.perform(makeFlowAction(url))`）；`presentKeys` = 单条目（当前 URL → 一个 entryKey），故扁平单页天然只有「当前屏」一个作用域。

### 3.5 持久化编码

`snapshot.ts`：`encodeSnapshot(s): string`（`stableStringify`，稳定输出）/ `decodeSnapshot(raw): SessionSnapshot | undefined`（`JSON.parse` + 结构校验 + version 检查；任何异常 → `undefined`，绝不抛进调用方）。Storage 是字符串 KV，编码即一条 `storage.set(key, encodeSnapshot(s))`。

### 3.6 浏览器桥接（browser）

```ts
createWebStorage(kind: "session" | "local"): Storage
```

实现 core `Storage` 接口的 Web Storage 适配器（`get`→`getItem`、`set`→`setItem`、`delete`→`removeItem`；`sessionStorage` 不可用时降级 no-op，不抛）。

```ts
interface SessionBridgeOptions {
    readonly store: SessionStore;
    readonly subscribeNavigation?: (onChange: () => void) => () => void; // 导航变更触发
    readonly debounceMs?: number;          // 默认 SESSION_DEFAULT_DEBOUNCE_MS
    readonly shouldRestore?: (snapshot: SessionSnapshot, currentUrl: string) => boolean;
}
createSessionBridge(options: SessionBridgeOptions): {
    restore(currentUrl: string): void | Promise<void>;  // boot 调用
    save(): void;
    clear(): void;
    dispose(): void;
}
```

- **自动捕获触发器**：导航变更（`subscribeNavigation`）时**先 `store.scope.prune(adapter.presentKeys())`**（丢弃离树条目的作用域——这就是 pop B 后 B 状态消失的落点），再防抖落盘；外加 `window` 的 `pagehide` 与 `visibilitychange(hidden)` 立即落盘（比 `beforeunload` 在移动端可靠）。`dispose` 解绑全部监听。
- **恢复**：boot 时 `restore(currentUrl)` → `store.load()`；命中且 `shouldRestore(snapshot, currentUrl)` 为真才整体应用（nav + slices 一个布尔门）。
- **`shouldRestore` 默认策略**（精确、无歧义，honors「显式深链优先」）：
    - `snapshot.navigation` 为 `SessionUrlLocation`（扁平）→ 恢复当且仅当 `currentUrl === snapshot.navigation.url` **或** `currentUrl` 路径为根 `/`（重载同页 / 全新进入 → 恢复；不同深链 → 跳过）。
    - `snapshot.navigation` 为 `SerializedNavigation`（结构化）→ 恢复当且仅当 `currentUrl` 路径为根 `/`（树无单一可比 URL，门在「入口」；要更细由应用覆盖 predicate）。
    - 无 `snapshot.navigation`（仅切片）→ 恢复（与 URL 无关）。
    - 「根」默认判定为路径 `=== "/"`；带 base path 的应用覆盖 `shouldRestore`。

### 3.7 接入 startBrowserApp（可选）

`BrowserAppConfig` 加可选：

```ts
session?: {
    readonly providers?: readonly SessionStateProvider[];
    readonly storage?: Storage;            // 默认 createWebStorage("session")
    readonly version?: number;
    readonly maxAgeMs?: number;
    readonly debounceMs?: number;
    readonly shouldRestore?: (snapshot, currentUrl) => boolean;
}
```

存在时：装配 `SessionStore`（导航适配器：有 `navigation` 配置 → 结构化适配器；否则 → URL 适配器接 `framework.perform`）+ `SessionBridge`，boot 时在首次导航后 `restore(initialUrl)`，并把 handle（save/clear）交给应用。**缺省整段不生效，原路径不变。**

## 4. 决策记录

| 决策                   | 选择                                     | 理由                                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 恢复范围               | 导航位置 + 全局切片 + **导航作用域状态** | 对标 SwiftUI `@SceneStorage`（全局）+ `@State`（位置作用域）；框架管时机+持久化+导航，应用定义状态内容                                                                                                                       |
| **导航作用域生命周期** | 按「树中存在的条目」prune                | 给出 SwiftUI 式 push/pop：A→B 保留 A、pop B 丢弃 B；TabView 切 tab 保活其它分支。身份 = `intent+stableStringify(params)`（跨重载稳定），同目标重复共享作用域为已知 v1 局限                                                   |
| 持久化                 | 可插拔 `Storage`，默认 `sessionStorage`  | 复用现有 DI；durability（标签级/跨关闭/跨设备）由应用换 Storage 决定                                                                                                                                                         |
| 捕获时机               | 自动（防抖 + pagehide）+ 手动 `save()`   | 最少接线即生效，敏感场景可手动控                                                                                                                                                                                             |
| **显式 URL vs 恢复**   | **显式深链优先**                         | 默认 `shouldRestore`（一个布尔门，gate 整份 nav+slices）：扁平 → `currentUrl` 等于快照 URL 或为根 `/`；结构化 → `currentUrl` 为根 `/`；仅切片（无 nav）→ 总恢复。直接深链 `/x` 不被旧会话覆盖。应用可改 predicate（见 §3.6） |
| **SSR 闪烁**           | **接受并文档化**                         | SSR 先渲染 URL 页、客户端再恢复到不同态会有一次跳变；CSR 可 boot 前恢复无此问题。恢复时机经 bridge 暴露给应用控                                                                                                              |
| 导航耦合               | 适配器接口 + 两 helper                   | SessionStore 不依赖 NavigationController，core 不产生 nav→session 反向耦合；扁平/结构化同机制                                                                                                                                |
| 时钟                   | 注入 `now()`                             | `capturedAt`/过期判断可测；不在 store 里裸调 `Date.now`                                                                                                                                                                      |

## 5. 错误处理与健壮性

- **版本/过期/畸形** → `load()` 返回 `undefined`，绝不为恢复旧态崩应用。
- **provider 抛错** → 经 `onError` 上报、跳过该切片，部分恢复优于不可用。
- **Storage 配额/不可用** → `persist` 吞错 + `onError`，不打断导航。
- **隐私** → 除导航外不注册 provider 即零捕获；敏感字段应用在 `capture()` 自排除。

## 6. 测试策略

- **core**：快照 `encode/decode` 往返（含 `scoped`）+ 版本不符 + 畸形 + 过期；`SessionStore` 的 capture/persist/load/restore（假 `Storage` + 假 provider + 假 nav adapter）；provider 抛错隔离；`maxAgeMs` 过期；`clear`；时钟注入。导航适配器两 helper（结构化 `hydrate`/`presentKeys` 全树 leaf、扁平 `perform`/单条目）。
- **core 导航作用域（重点）**：`NavigationScopedState` 的 get/set/delete/keys；`prune(presentKeys)` 只留存在键。**SwiftUI 式生命周期**端到端：`[A]` set A 态 → push B、set B 态、prune present `{A,B}` → A、B 都在；pop B、prune present `{A}` → **B 态消失、A 态保留**；TabView 切 tab → prune 保活两分支；跨 capture→load→restore 后 `scoped` 完整回填、再 pop 仍正常丢弃。`sessionEntryKey` 与 `collectLeafKeys` 收全树 leaf（含不可见/未激活分支）。
- **browser**：`createWebStorage` 适配器（含 sessionStorage 不可用降级）；`SessionBridge` 防抖 + `pagehide`/`visibilitychange` 落盘（假定时器 + jsdom 事件）+ `dispose` 解绑；`shouldRestore` 默认策略（根/同 URL 才恢复）；`startBrowserApp` opt-in 装配 + boot 恢复；**无 `session` 配置 → 原路径不变**（回归）。

## 7. 改动清单

新增（core）：`session/types.ts`、`session/snapshot.ts`、`session/scoped-state.ts`（`NavigationScopedState` + `sessionEntryKey` + `collectLeafKeys`）、`session/session-store.ts`、`session/navigation-adapter.ts`、`session/index.ts` + 各 `*.test.ts`；core `index.ts` 导出。
新增（browser）：`session-bridge.ts`、`web-storage.ts` + 测试；`start-app.ts` 接 `session` 配置 + `index.ts` 导出。
改（front）：`index.ts` / `browser.ts` 显式再导出新 browser/core 符号。
文档：本 spec + 使用指南（`packages/front/docs/12-session-restoration.md` + `zh/`）+ sidebar。
changeset：`@finesoft/front: minor`。

## 8. 开放问题

- `shouldRestore` 默认策略的「根 URL」判定：是否需要支持应用自定义「entry 路径集合」？v1 先用 `/` ∪ 快照 URL，predicate 可覆盖。
- 是否需要 `migrate(oldSnapshot, oldVersion)` 钩子做跨版本迁移？v1 不做（版本不符直接丢弃），留接口位。
