# 11. 导航

第 2–4 章讲的是**扁平单页**生命周期：一个 URL → 一个 intent → 一个页面。本章补上**结构化导航** —— 一棵递归的、与 UI 无关的导航树，对标 SwiftUI 的 `NavigationStack`、`TabView`、`NavigationSplitView`。

框架持有导航的**状态**、URL/history 接线、以及对每个目标的 intent 派发。它**不含任何 UI**。你的 `Page` 模型与之前一样保持内容无关 —— tabs、stack、split 怎么画，由你用 Svelte / React / Vue 自行决定。

单个叶子树**逐位等价**于扁平单页，因此本特性完全可选：从不调用 `defineNavigation` 的应用行为不变。

## 心智模型

导航状态是一棵由四种节点构成的树：

```
NavigationNode = LeafNode | StackNode | TabsNode | SplitNode
```

| 节点        | 持有                            | 语义                                                                   | SwiftUI               |
| ----------- | ------------------------------- | ---------------------------------------------------------------------- | --------------------- |
| `LeafNode`  | `intent` + `params`             | 一个目标（一次 intent 派发）                                           | 一个 destination view |
| `StackNode` | 有序 `entries[]`                | 一条路径：`entries[0]` 是根，末尾是可见的栈顶                          | `NavigationStack`     |
| `TabsNode`  | `active` 键 + `branches`        | 并列分支；**仅激活分支可见**                                           | `TabView`             |
| `SplitNode` | `columns[]` + 可选 `visibility` | 多列并存；可见集**默认全部列**，可收窄为 `detailOnly` / `doubleColumn` | `NavigationSplitView` |

叶子持有 `intent` + `params`，**不是** `Page`。树是纯粹的、可序列化的数据，描述「要去哪」；「那里是什么」（`Page`）由 controller 在解析时产出，并随快照交回。这正是树能进 URL / history 的原因。

内部节点递归嵌套 —— 一个由 `NavigationStack` 组成的 `TabView`、detail 列是 stack 的 split，等等。

## 声明一棵树

构造器与其它一切一样从 `@finesoft/front` 导入：

```ts
import { leaf, stack, tabs, split } from "@finesoft/front";

// 一个目标 —— 等价于今天的扁平单页
leaf("home");
leaf("product", { id: 42 });

// 栈：只有根，或根 + 已 push 的 entry
stack(leaf("feed"));
stack([leaf("feed"), leaf("post", { id: 7 })]);

// Tabs：每个分支自成一个栈
tabs({
    active: "home",
    branches: {
        home: stack(leaf("home")),
        search: stack(leaf("search")),
        me: stack(leaf("me")),
    },
});

// Split：sidebar + detail，detail 是一个栈
split([
    { id: "sidebar", content: leaf("folders") },
    { id: "detail", content: stack(leaf("folder", { id: "inbox" })) },
]);
```

`tabs()` 缺省 `order` 时按 `branches` 的插入顺序推导稳定 tab 顺序。`stack()` 接受单个根节点或一个 entries 数组。

## 由 NavigationStack 组成的 TabView

最常见的形态：底部标签栏，每个 tab 保留自己的导航深度。

```ts
// src/bootstrap.ts
import { type Framework, defineRoutes, defineNavigation, leaf, stack, tabs } from "@finesoft/front";
import { HomeController } from "./lib/controllers/home";
import { SearchController } from "./lib/controllers/search";
import { ProfileController } from "./lib/controllers/profile";
import { PostController } from "./lib/controllers/post";

export function bootstrap(framework: Framework): void {
    defineRoutes(framework, [
        { path: "/", intentId: "home", controller: new HomeController() },
        { path: "/search", intentId: "search", controller: new SearchController() },
        { path: "/me", intentId: "me", controller: new ProfileController() },
        { path: "/posts/:id", intentId: "post", controller: new PostController() },
    ]);
}

// 导航结构，只声明一次
export const navigation = defineNavigation({
    initial: tabs({
        active: "home",
        branches: {
            home: stack(leaf("home")),
            search: stack(leaf("search")),
            me: stack(leaf("me")),
        },
    }),
});
```

`defineNavigation` 返回一个规范化的定义，附带两个适配器 —— `toBrowserConfig()` 给 CSR、`toSSRDefinition()` 给 SSR —— 因此你只声明**一次**树，就能把各自需要的形态交给对应 runner。

### 接入浏览器

`startBrowserApp` 新增一个可选 `navigation` 字段和一个 `onNavigationReady` 回调，把 `NavigationHandle` 交给你：

```ts
// src/main.ts
import { startBrowserApp, type NavigationHandle } from "@finesoft/front";
import { bootstrap, navigation } from "./bootstrap";
import { mount } from "./lib/mount";

let handle: NavigationHandle;

startBrowserApp({
    bootstrap,
    mount,
    callbacks,
    navigation: navigation.toBrowserConfig(),
    onNavigationReady(h) {
        handle = h;
        // 快照变更时重渲染
        h.subscribe((snapshot) => mountNavigation(snapshot));
        mountNavigation(h.getSnapshot());
    },
});
```

提供 `navigation` 时，框架会构建 `NavigationController` 和 history 桥、解析首屏、把 handle 交给你。缺省时 `startBrowserApp` 走原有扁平单页路径，行为不变。

## 驱动导航

`NavigationHandle` 暴露各操作。每个都返回 `Promise<NavigationSnapshot>`（提交后的树 + 每个可见目标解析出的 `Page`），并在浏览器侧把新状态写入 history/URL。

```ts
// 在激活栈压入一个目标
await handle.push("post", { id: 7 });

// 弹回
await handle.pop(); // 一层
await handle.pop(2); // 两层 —— 绝不越过栈根
await handle.popToRoot();

// 替换当前栈顶（如 登录 → dashboard 且不留返回步）
await handle.replaceTop("dashboard");

// 切换激活 tab —— 其它 tab 保留各自栈深
await handle.selectTab("search");
```

`pop` 绝不弹到栈根之下。不显式给 target 时，栈操作作用于**最深的激活栈**（当前可见的那个），`selectTab` 作用于**最外层**的 tabs 节点 —— 这正是「标签栏驱动聚焦栈」想要的。

### 读取结果

`NavigationSnapshot` 就是你拿来渲染的东西：

```ts
const snapshot = handle.getSnapshot();
snapshot.tree; // 当前 NavigationNode 树
snapshot.destinations; // ResolvedDestination[]：{ intent, params, page, status? }
```

`destinations` 的顺序与 `collectVisibleDestinations(tree)` 一致：tabs 节点**只**贡献激活分支，split **每个**非空列都贡献。这个顺序也正是服务端预取的内容。

你的视图层遍历 `snapshot.tree` 排布外壳（有哪些 tab、每个栈多深），从 `snapshot.destinations` 读页面内容。框架从不告诉你**怎么**画。

## NavigationSplitView

split 视图同时展示多列 —— 经典的 sidebar + detail（+ sub-detail）布局。一列的选择驱动下一列。

```ts
export const navigation = defineNavigation({
    initial: split([
        { id: "sidebar", content: leaf("mailboxes") },
        { id: "list", content: undefined }, // 稍后选择
        { id: "detail", content: undefined },
    ]),
});
```

用 `selectColumn(columnId, intent, params?)` 设置某列内容：

```ts
// 选一个邮箱 → 填充 "list" 列
await handle.selectColumn("list", "messages", { mailbox: "inbox" });

// 选一封邮件 → 填充 "detail" 列
await handle.selectColumn("detail", "message", { id: 1024 });

// 重选邮箱 → 清空 "list" 与 "detail"（它之后的所有列）
await handle.selectColumn("list", "messages", { mailbox: "archive" });

// 给 intent 传 undefined 显式清空某列
await handle.selectColumn("detail", undefined);
```

设置某列会**清空它之后的所有列**。重选 sidebar 会正确作废已打开的 detail，于是你绝不会渲染出「旧 detail 配新 sidebar」的错配。

默认所有列都可见，快照的 `destinations` 里**每个非空列**各一条 —— 框架会派发（服务端则预取）它们每一个。

### 列可见性

对标 SwiftUI 的 `NavigationSplitViewVisibility`，split 带一个可选的 **visibility** —— 这是**可绑定、可序列化的导航状态**（不是样式），它决定哪些列算可见，进而决定服务端预取什么：

| `visibility`               | 可见列                    |
| -------------------------- | ------------------------- |
| `automatic`（缺省）/ `all` | 全部列                    |
| `doubleColumn`             | 首列 + 末列（隐藏中间列） |
| `detailOnly`               | 仅末列（detail）          |

```ts
import { SPLIT_VISIBILITIES, visibleSplitColumns } from "@finesoft/front";

// 声明时即指定（例如深链直达 detail）
split(
    [
        { id: "sidebar", content: leaf("mailboxes") },
        { id: "detail", content: leaf("message", { id: 7 }) },
    ],
    SPLIT_VISIBILITIES.DETAIL_ONLY,
);

// 或运行时切换 —— 新变可见的列会被派发，隐藏的列从快照中移除
await handle.setVisibility(SPLIT_VISIBILITIES.DETAIL_ONLY); // 只剩 detail 目标
await handle.setVisibility(SPLIT_VISIBILITIES.ALL); // 重新预取 sidebar + list

// 无需自己重实现映射，直接拿可见列渲染
for (const col of visibleSplitColumns(splitNode)) renderColumn(col);
```

`detailOnly` 深链在服务端**只**解析并预取 detail 列 —— 隐藏列在显示前不耗成本。compact 窗口塌缩成单栈（SwiftUI 的 `preferredCompactColumn`）是视口反应式的纯渲染，框架不碰，完全交给你：读 `getPlatform()` / 视口，自行把 split 塌成栈视图。

## 定位嵌套容器

当一棵树里有不止一个 stack/tabs/split 时，传一个显式的 `target` 路径来操作更深的那个。路径是从根出发的步骤序列：

```ts
import type { NavigationPath } from "@finesoft/front";

// split 的 detail 列里那个栈
const detailStack: NavigationPath = [
    { kind: "column", id: "detail" },
    { kind: "stack-entry", index: 0 },
];

await handle.push("attachment", { id: 3 }, { target: detailStack });
await handle.selectTab("photos", someTabsPath);
```

不给 `target` 时，操作默认作用于激活路径 —— 绝大多数情况下这都是对的。

## 纯操作（不需要 controller）

上面这一切都由纯粹、不可变的树函数支撑，你可以直接用 —— 写测试、做乐观计算、或自建 controller：

```ts
import {
    push,
    pop,
    selectTab,
    collectVisibleDestinations,
    resolveActivePath,
} from "@finesoft/front";

const next = push(tree, leaf("post", { id: 7 })); // 返回一棵新树
const visible = collectVisibleDestinations(next); // readonly LeafNode[]
const activePath = resolveActivePath(next);
```

它们绝不修改输入 —— 只有被改动路径上的节点会重建，树的其余部分按引用复用。非法 target（如对非 tabs 节点 `selectTab`、对空栈 target 执行 pop）会抛 `NavigationError`。

## 服务端渲染

SSR 预取**所有**可见目标并把它们 —— 连同树本身 —— 序列化进 HTML，于是浏览器首屏直接复用服务端结果、不再取数。多列 split 视图天然预取多个 intent。

用 `createSSRNavigationRender` 配合 SSR 适配器：

```ts
// src/ssr.ts
import { createSSRNavigationRender } from "@finesoft/front";
import { bootstrap, navigation } from "./bootstrap";
import { renderApp } from "./lib/render";

export const render = createSSRNavigationRender({
    bootstrap,
    getErrorPage: (status, message) => ({
        id: `error-${status}`,
        pageType: "error",
        title: message,
    }),
    renderApp, // (page, framework, snapshot) => { html, head, css }
    navigation: navigation.toSSRDefinition(),
});
```

`renderApp` 收三个参数：**主目标**页面（激活叶子的结果 —— 与扁平 SSR 的 `renderApp` 签名兼容）、framework、以及完整的多区域 `snapshot`，让你渲染 tabs/split 布局：

```ts
function renderApp(page, framework, snapshot) {
    // page                  → 聚焦目标（如用于 <title>、status）
    // snapshot.tree         → 要画哪些 tab / 列
    // snapshot.destinations → 每个可见区域的 Page
    return renderYourFramework(snapshot);
}
```

底层原理：每个可见目标经**既有的** `PrefetchedIntents` 通道序列化为一条普通的 `{ intent, data: page }`，再额外挂一条承载序列化树的哨兵条目。`@finesoft/server` **零改动** —— 它经同一个 `#serialized-server-data` 脚本透传哨兵。hydration 时浏览器桥从 history state（或哨兵）读回树，并复用预取的页面。

若某请求没有结构化深链、应用也没提供骨架，SSR 回退到 `Router.resolve(url)` → 单个叶子 —— 即今天的扁平单页（含其 `renderMode`）。404 路径不变。

## 用 `createFullStateCodec` 做深链

默认情况下，**激活叶子**驱动 URL（`/posts/7`），完整的树通过 history state 旁路传输 —— 聚焦目标拥有干净、可分享的 URL。若要把**整棵**树编码进 URL 以支持完整深链（分享一个能还原 tab、栈深、split 选择的链接），改用 `createFullStateCodec`：

```ts
import { createFullStateCodec } from "@finesoft/front";

export const navigation = defineNavigation({
    initial: tabs({
        active: "home",
        branches: { home: stack(leaf("home")), me: stack(leaf("me")) },
    }),
    codec: createFullStateCodec(), // 整树 → "?__nav=..." query 参数
});
```

此时 URL 形如 `/me?__nav=<编码后的树>`，粘贴它即可在 SSR 与浏览器两侧还原完整导航状态。编码紧凑（base64url）、稳定（key 排序，相同树永远产出相同串）、无损。传 `createFullStateCodec({ param: "nav" })` 可重命名保留 query 参数。

如需自定义 URL 方案，你也可以实现自己的 `NavigationCodec` —— 两个内置实现仅依赖 router 的 `getRoutes()`（和可选的 `reverse()`），别无其它。

## 守卫照常生效

导航级 `beforeLoad` / `afterLoad` 守卫在每次导航时对**主目标**（激活叶子）执行，`redirect` / `rewrite` / `deny` 语义与[第 3 章](./03-middleware.md)一致：

```ts
export const navigation = defineNavigation({
    initial: tabs({
        active: "home",
        branches: { home: stack(leaf("home")), me: stack(leaf("me")) },
    }),
    beforeLoad: [authGuard],
});
```

- `redirect` → 当作 SPA 内跳处理（浏览器复用 FlowAction 管线）；该目标不派发。
- `rewrite` → 用新 URL 重新解析出该目标的 intent/params。
- `deny` → 给目标打上 deny status，不派发其 intent。

单个目标的 dispatch 失败绝不会从操作里抛出 —— 它在该目标上记一个 `status` 和一张兜底页（与 controller 一样的 `fallback` 安全网），于是某一列失败不会让整屏空白。

## 向后兼容

- 不向 `startBrowserApp` / `createSSRRender` 传 `navigation` 的应用走**原有扁平路径**，行为零变化。
- 单叶子树等价于扁平单页：一个可见目标、一次 resolve/dispatch、一对 before/after。SSR 仅在 `serverData` 多挂一条树哨兵（在抵达 `PrefetchedIntents` 前被剔除）。
- `Page` 保持内容无关。导航在你的页面**周围**加结构，从不规定页面形状或你怎么渲染它。

## 下一步

- [中间件](./03-middleware.md) —— 导航复用的守卫语义
- [渲染与 Hydration](./04-rendering-and-hydration.md) —— 预取结果如何跨越 SSR → CSR 边界
