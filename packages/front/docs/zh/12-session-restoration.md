# 12. 会话恢复

框架已经能恢复**首屏**：SSR 把 prefetch 出来的 intent 结果经 `PrefetchedIntents` 注入 HTML，浏览器在首次导航时复用它们；结构化导航的当前树也会随 `history.state` 走前进 / 后退。

但有一类状态以上手段**全都救不回**：用户**硬重载 / 标签崩溃 / 关掉再回来**时「当时在干什么」—— 他在哪一屏（或哪个栈深、哪个 tab、split 哪一列）、表单里打了一半的草稿、列表滚到哪里。内存里的 `history.state` map 整页重载即清空，`PrefetchedIntents` 只覆盖服务端渲染的那一屏。

**会话恢复**填这个缺口：把一份带版本、JSON 安全的**会话快照**（导航位置 + 应用注册的状态切片 + 导航作用域的逐屏状态）序列化到可插拔 `Storage`，并在全新加载时重水化。框架**不含任何 UI** —— 它只恢复**状态**，应用据此自行重渲染。

它完全可选：从不向 `startBrowserApp` 传 `session` 的应用**逐位等价**于原行为，毫无变化。

## 两种作用域

一份快照捕获两层状态，一起序列化、跨重载一起恢复：

| 作用域             | 存放于   | 键             | 生命周期                               | SwiftUI 对标    |
| ------------------ | -------- | -------------- | -------------------------------------- | --------------- |
| **全局切片**       | `slices` | `provider.key` | 整个会话（主题、跨屏向导草稿…）        | `@SceneStorage` |
| **导航作用域状态** | `scoped` | `entryKey`     | 绑定到某个导航条目 —— 条目离树即被丢弃 | `@State`        |

- **全局切片**是 app-wide 的。每个切片注册一个 `SessionStateProvider`；框架编排*何时*捕获与落盘，但从不解释内容 —— 它只搬运。
- **导航作用域状态**绑定到某个*导航条目*，对标 SwiftUI 视图 `@State` 的位置作用域生命周期（见下）。

## 全局切片：`SessionStateProvider`

应用为每个切片注册一个 provider。`capture()` 返回 JSON 安全的同步值；`restore(data)` 把它放回（应用自行 `setState` / 回填表单 / 滚动）：

```ts
import type { SessionStateProvider } from "@finesoft/front";

const themeSlice: SessionStateProvider<string> = {
    key: "theme",
    capture: () => getCurrentTheme(),
    restore: (theme) => applyTheme(theme),
};
```

框架原样搬运值、从不窥探 —— 所以捕获什么由**你**决定。敏感字段就在 `capture()` 里自行排除；不注册的切片永不被捕获。

## 导航作用域状态：SwiftUI `@State` 生命周期

导航作用域状态是更有意思的一半。它按**条目身份**而非可见性建键，遵循与 SwiftUI 视图 `@State` 相同的位置作用域生命周期：

> `A` → push `B` → 返回（pop `B`）到 `A`：**`B` 的状态被丢弃，`A` 的状态仍在。**

机制：每个条目的状态袋按 `entryKey = intent + " " + stableStringify(params)` 存放 —— 与导航 controller 给目标用的身份同源，故**跨重载稳定**。每次导航提交后，框架把 scoped map **prune** 到树中**实际存在**的条目 —— 注意是*存在*，不是*可见*。条目已不在树中的键即被丢弃。

```ts
import { sessionEntryKey } from "@finesoft/front";

// 渲染某屏时，用该条目的键读写它的作用域袋：
const key = sessionEntryKey("post", { id: 7 });
store.scope.set(key, { scroll: 240, draft: "评论打了一半" });
const bag = store.scope.get(key); // -> { scroll: 240, draft: "..." } | undefined
```

逐步走一遍生命周期：

- **push `B`** → 树 `[A, B]`，present `{A, B}` → `A` 的状态**保留**（`A` 仍在栈中、只是不可见），`B` 拿到自己的作用域。
- **pop `B`** → 树 `[A]`，present `{A}` → **`B` 的作用域被 prune 丢弃**，`A` 的原样保留；返回 `A` 按保留态渲染。
- **切 TabView 的 tab** → 其它分支仍在树中 → 其状态保活（与 SwiftUI 让未激活 tab 保持挂载一致）。
- **跨重载** → `scoped` 随快照序列化；重载后每个仍在树的条目恢复各自作用域，之后 pop 照常丢弃。

`store.scope` 是 store 持有的 `NavigationScopedState` 实例 —— `get` / `set` / `delete` / `keys`，外加框架替你调用的 `prune(presentKeys)`。用高层 `startBrowserApp({ session })` 时无需直接持有 store：`mount` 回调（context）交给你的 `SessionHandle` 上的 `handle.scope` 就是同一个实例（restore 重建后仍指向最新），照样 `handle.scope.get(entryKey)` / `set(entryKey, data)`。

### 扁平 vs 结构化：保留语义**本质就是栈**

「把 `A` 留在 `B` 底下、pop 时丢 `B`、恢复 `A`」这套行为，按定义就是**栈语义** —— 所以它只在**结构化导航**里成立，那里栈 / 树能持有*存在但不可见*的条目。

**扁平单页没有栈**：`A → B` 是整页替换，故 `presentKeys()` 恒为单条目（当前 URL）。一离开某屏，其作用域即被 prune，浏览器**返回**是 fresh 重渲染。

两种模式都支持「当前屏作用域 + 跨重载恢复」。要「返回时保留上一屏」，就把它建成结构化栈 —— 用 push 而非 replace。这正是 `NavigationStack` 的*意义*，不是扁平模式的缺陷。

## 快照

`createSessionStore(options)` 返回 `SessionStore` 编排器。`capture()` 组装快照但不落盘；快照模型为：

```ts
interface SessionSnapshot {
    readonly version: number;
    readonly navigation?: SerializedNavigation | SessionUrlLocation; // 结构化树 | { url }
    readonly slices: Readonly<Record<string, unknown>>; // provider.key -> capture()
    readonly scoped: Readonly<Record<string, unknown>>; // entryKey -> 状态袋
    readonly capturedAt: number; // epoch ms，用于 maxAgeMs 过期判断
}
```

`navigation` 用一个轻判别区分：`SerializedNavigation` 始终带 `kind`（leaf/stack/tabs/split），扁平的 `SessionUrlLocation` 带 `url`。用 `isUrlLocation(nav)` 区分二者。

store 暴露：

```ts
interface SessionStore {
    register(provider: SessionStateProvider): () => void; // 返回反注册函数
    readonly scope: NavigationScopedState;
    capture(): SessionSnapshot; // 组装（nav + slices + scoped），无 I/O
    persist(snapshot?: SessionSnapshot): void; // 省略则先 capture()，再落盘
    load(): SessionSnapshot | undefined; // 读取 + 校验（version / maxAge / 结构）
    restore(snapshot?: SessionSnapshot): void | Promise<void>; // 省略则先 load()，再应用
    clear(): void; // 清除持久化快照
    save(): void; // capture + persist —— 手动逃生口
}
```

`load()` 会丢弃版本不符、`capturedAt` 超过 `maxAgeMs`、或结构畸形的快照 —— 返回 `undefined`，绝不向应用抛错。`capture()` / `restore()` 抛错的 provider 被隔离：跳过其切片、错误走 `onError`，快照其余部分照常存活。

## 持久化：默认 `sessionStorage`，可替换

快照经稳定 stringify 编码，作为一条 `storage.set(key, ...)` 写入。`Storage` 是 core 既有的依赖接口，所以 durability 由**你**决定：

```ts
import { createWebStorage } from "@finesoft/front";

createWebStorage("session"); // sessionStorage —— 标签级，关闭即清（默认）
createWebStorage("local"); // localStorage —— 跨标签、跨重启持久
```

`createWebStorage` 把 `get`/`set`/`delete` 映射到 `getItem`/`setItem`/`removeItem`，写入时吞掉配额错（会话恢复是尽力而为，绝不打断导航），选定的 Web Storage 不可用时（如隐私模式 `SecurityError`）降级为安全 no-op。

因为它就是 `Storage` 接口，你可以塞**任意**实现 —— 测试用内存版，或服务端同步的 `Storage` 实现跨设备恢复。框架 v1 不内建服务端端点，但接缝是开放的。

## 接入浏览器

向 `startBrowserApp` 传可选的 `session`。存在时，框架构建 `SessionStore`、注册你的 providers、装配 `SessionBridge`（导航变更自动捕获 + `pagehide`/`visibilitychange`），在首次导航后跑 boot 恢复，并把 `SessionHandle` 交给你：

```ts
// src/main.ts
import { startBrowserApp } from "@finesoft/front";
import { bootstrap } from "./bootstrap";
import { themeSlice, draftSlice } from "./lib/session";

startBrowserApp({
    bootstrap,
    callbacks,
    session: {
        providers: [themeSlice, draftSlice],
        // storage 缺省为 createWebStorage("session")
        maxAgeMs: 1000 * 60 * 60 * 24, // 丢弃超过一天的快照（可选）
    },
    mount(target, { session, app }) {
        // session: SessionHandle（save/clear/scope/…）；app：统一的 nav+session 句柄。
        // 自动捕获/恢复已在跑；用 session.save() / session.clear() 作逃生口。
        // ... 把 UI 挂载到 target，将 app（或 session）传给组件 ...
        return () => undefined;
    },
});
```

`session` **缺省**时，以上整段不运行，原有 `startBrowserApp` 路径逐位不变。

### 扁平 vs 结构化接线（自动）

`startBrowserApp` 替你挑选导航适配器：

- **有** `navigation` 配置 → 结构化 `createNavigationSessionAdapter(controller)`：序列化整棵树，恢复时 `hydrate` 回去。自动捕获由导航 handle 的 `subscribe` 驱动。
- **无** `navigation`（扁平单页）→ 接 `framework.perform(makeFlowAction(url))` 的 `createUrlSessionAdapter`：捕获 `{ url }`，恢复时导航过去。

只有自己装配 store 时（如在服务端、或测试里）才需要直接选适配器。

## 句柄：手动 save / clear / dispose

`SessionHandle`（通过 mount context 交付）给你逃生口 —— 自动捕获已在跑，但你可强制落盘、清快照、或整体拆除。统一的 `app` 句柄把导航命令与 session 的 `save`/`clear`/`scope` 合并，组件拿一个对象即可，免自己拼 controller：

```ts
interface SessionHandle {
    restore(currentUrl: string): void | Promise<void>; // boot 恢复（已替你调过）
    save(): void; // 立即强制落盘
    clear(): void; // 丢弃持久化快照（如登出时）
    dispose(): void; // 反订阅导航 + 解绑 pagehide/visibilitychange + 清定时器
}
```

登出时调 `handle.clear()`，下个用户就不会继承陈旧会话；自己拆除应用实例时调 `handle.dispose()`。

### 何时捕获？

你很少需要调 `save()` —— 捕获是自动的：

- **导航变更时**：bridge **先**把 scoped map prune 到 `adapter.presentKeys()`（这正是「pop `B` 丢掉 `B` 状态」的落点），再**防抖**落盘（默认 `SESSION_DEFAULT_DEBOUNCE_MS` = 500 ms，合并连续导航）。用 `session.debounceMs` 调。
- **`pagehide` 与 `visibilitychange`（hidden）时**：**立即**落盘并取消挂起的防抖 —— 比 `beforeunload` 在移动端更可靠（标签切后台 / 被回收前能抓到末态）。

## 深链策略：`shouldRestore`

boot 时 bridge 读快照，**仅当** `shouldRestore(snapshot, currentUrl)` 通过才应用 —— 整份 `nav + slices` 恢复共用一个布尔门。默认的 `defaultShouldRestore` 遵循**显式深链优先于陈旧会话**：

| 快照 `navigation`                    | 恢复当且仅当…                                                   |
| ------------------------------------ | --------------------------------------------------------------- |
| **扁平**（`SessionUrlLocation`）     | `currentUrl === snapshot.navigation.url` **或**当前路径为根 `/` |
| **结构化**（`SerializedNavigation`） | 当前路径为根 `/`                                                |
| **无**（仅切片）                     | 总恢复（与 URL 无关）                                           |

于是重载同页（或全新进入 `/`）会恢复；打开不同深链 `/x` 则**不会**被旧会话覆盖。「根」判定为路径 `=== "/"`（剥离 query/hash）。带 base path 的应用应覆盖该门：

```ts
session: {
    providers: [themeSlice],
    shouldRestore: (snapshot, currentUrl) => currentUrl.startsWith("/app/"),
}
```

恢复到与 SSR'd URL 不同的态会产生一次客户端跳变（SSR 渲染 URL 那屏，客户端再恢复）。该时机经 bridge 暴露给你掌控；纯 CSR 应用可在首次绘制前恢复、完全避免它。

## 哪些**不**被捕获

- **你没注册的 DOM。** 框架从不扫描 DOM。状态切片就是你的 provider `capture()` 出来的那些 —— 仅此而已。
- **不注册任何 provider 时的一切。** 只注册导航（或什么都不注册）时，捕获实质为零 —— 隐私默认。
- **你排除的敏感字段。** `capture()` 是你的过滤器；token、PII 之类在此剥掉。
- **陈旧 / 过期 / 畸形的快照。** `load()` 返回 `undefined`，而非为恢复坏态崩掉应用。

## 向后兼容

- 不向 `startBrowserApp` 传 `session` 的应用走**原路径**、零行为变化 —— 整个特性被那一个字段门控。
- 会话恢复对服务端无任何要求。提供自己的 `Storage` 即可实现服务端同步快照，但框架不内建任何东西。
- 框架恢复**状态**、绝不恢复 UI。你的 `Page` 模型与渲染方式原封不动。

## 下一步

- [导航](./11-navigation.md) —— 其条目为逐屏状态划定作用域的结构化树
- [渲染与 Hydration](./04-rendering-and-hydration.md) —— 首屏如何已经通过 prefetch 结果被恢复
- [DI 容器](./07-di-container.md) —— 会话恢复落盘所经的 `Storage` 依赖
