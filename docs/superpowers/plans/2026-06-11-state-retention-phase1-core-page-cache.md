# 会话恢复完整实现 · Phase 1：控制器页面缓存（core 地基）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `NavigationController` 按条目缓存已解析的页面——pop / 切 tab 回到「仍在树中」的条目时复用缓存、不重新 dispatch（守卫照常跑），离树条目的缓存随树 prune 清除。这是「实例保活」的控制器层（§4.4），也是后续 islands / 重载层的地基。

**Architecture:** 控制器闭包内新增 `Map<entryKey, ResolvedDestination>`。`resolveTree` 的复用源从「上一快照的可见目标」改为该缓存（缓存是超集——含上一快照 + 所有仍在树中的已解析条目）；命中缓存的主目标把缓存页喂给 `resolvePrimary`（守卫跑、跳过 dispatch），命中的次目标直接复用。每轮提交后写穿缓存（仅成功页，`status===undefined`）并按 `collectAllLeaves(tree)` prune。新增 `collectAllLeaves`（全部存在叶子）于 operations，并让 session 的 `collectLeafKeys` 复用它（去重）。新增 opt-in `invalidate`/`refresh`。

**Tech Stack:** TypeScript（strict, ESNext）、Vite+ 工具链（`vp test` / `vp check`）、Vitest（`vite-plus/test`）。仅改 `@finesoft/core`，不碰 browser/front。

**落地分支：** `feat/session-restoration`（当前分支）。**不新建分支。**

**全局约定（每个任务都适用）：**
- 跑单文件测试：`vp test <文件路径>`；跑某目录：`vp test <目录>`。
- 类型/lint 校验**务必 scoped 到 src+test 目录**（bare `vp check` 会在 `packages/front/CHANGELOG.md` 的 fmt 处 halt）：`vp check packages/core/src packages/core/test`。
- 导入一律从 `vite-plus` / `vite-plus/test`，不从 `vite`/`vitest`。
- 提交信息用中文 conventional commit；只 `git add` 本任务实际改动的文件。

---

## Task 1：`collectAllLeaves`（全部存在叶子）

收集树中**全部**叶子（含不可见：栈非顶 entry、未激活 tab 分支、所有非空 split 列），区别于只走可见分支的 `collectVisibleDestinations`。供控制器缓存 prune 与 session `collectLeafKeys` 共用。

**Files:**
- Modify: `packages/core/src/navigation/operations.ts`（在 `collectVisibleDestinations` 段后追加）
- Modify: `packages/core/src/navigation/index.ts`（Operations 导出段加 `collectAllLeaves`）
- Test: `packages/core/test/navigation/operations.test.ts`（追加 describe 块 + 导入）

- [ ] **Step 1：写失败测试**

在 `packages/core/test/navigation/operations.test.ts` 顶部 import 列表里加入 `collectAllLeaves`（与现有 `collectVisibleDestinations` 同一 import 块）：

```ts
import {
    collectAllLeaves,
    collectVisibleDestinations,
    findNearestStack,
    findNode,
    pop,
    popTo,
    popToRoot,
    push,
    replaceTop,
    resolveActivePath,
    selectColumn,
    selectTab,
    setVisibility,
    visibleSplitColumns,
} from "../../src/navigation/operations";
```

在文件末尾追加：

```ts
// =====================================================================
// collectAllLeaves（全部存在，非仅可见）
// =====================================================================

describe("collectAllLeaves", () => {
    test("leaf → [leaf]", () => {
        expect(collectAllLeaves(leaf("home"))).toEqual([leaf("home")]);
    });

    test("stack → ALL entries（含非顶，区别于 collectVisibleDestinations）", () => {
        const tree = stack([leaf("root"), leaf("top")]);
        expect(collectAllLeaves(tree)).toEqual([leaf("root"), leaf("top")]);
        // 对照：可见只取栈顶
        expect(collectVisibleDestinations(tree)).toEqual([leaf("top")]);
    });

    test("tabs → ALL branches（含未激活），按 Object.values 序", () => {
        const tree = tabs({ active: "a", branches: { a: leaf("a"), b: leaf("b") } });
        expect(collectAllLeaves(tree)).toEqual([leaf("a"), leaf("b")]);
    });

    test("split → 全部非空列；空列跳过", () => {
        const tree = split([{ id: "list", content: leaf("list") }, { id: "detail" }]);
        expect(collectAllLeaves(tree)).toEqual([leaf("list")]);
    });

    test("嵌套：收集隐藏栈底 + 未激活分支的全部叶子", () => {
        const tree = tabs({
            active: "home",
            branches: {
                home: stack([leaf("home"), leaf("detail", { id: 2 })]),
                notes: stack([leaf("notes")]),
            },
        });
        expect(collectAllLeaves(tree)).toEqual([
            leaf("home"),
            leaf("detail", { id: 2 }),
            leaf("notes"),
        ]);
    });
});
```

- [ ] **Step 2：跑测试，确认失败**

Run: `vp test packages/core/test/navigation/operations.test.ts`
Expected: FAIL —— `collectAllLeaves` 未导出（import 报错 / `collectAllLeaves is not a function`）。

- [ ] **Step 3：实现 `collectAllLeaves`**

在 `packages/core/src/navigation/operations.ts` 的 `collectVisibleDestinations` / `collectInto` 段之后（约 line 185 之后、`visibleSplitColumns` 之前），追加：

```ts
/**
 * 收集树中**全部存在**的叶子（含不可见：栈非顶 entry、未激活 tab 分支、所有非空 split 列）。
 * 区别于 `collectVisibleDestinations`（只沿可见分支）—— 保活 / 缓存 prune / 作用域保留需要
 * 全部 present 条目。顺序：栈按序、tabs 按 `Object.values(branches)` 序、split 按列序。
 */
export function collectAllLeaves(tree: NavigationNode): readonly LeafNode[] {
    const out: LeafNode[] = [];
    collectAllInto(tree, out);
    return out;
}

function collectAllInto(node: NavigationNode, out: LeafNode[]): void {
    switch (node.kind) {
        case NAVIGATION_NODE_KINDS.LEAF:
            out.push(node);
            return;
        case NAVIGATION_NODE_KINDS.STACK:
            for (const entry of node.entries) collectAllInto(entry, out);
            return;
        case NAVIGATION_NODE_KINDS.TABS:
            for (const branch of Object.values(node.branches)) collectAllInto(branch, out);
            return;
        case NAVIGATION_NODE_KINDS.SPLIT:
            for (const col of node.columns) {
                if (col.content !== undefined) collectAllInto(col.content, out);
            }
            return;
    }
}
```

在 `packages/core/src/navigation/index.ts` 的 Operations 导出段，把 `collectAllLeaves` 加进去（字母序，放 `collectVisibleDestinations` 前）：

```ts
// ===== Operations（纯函数）=====
export {
    collectAllLeaves,
    collectVisibleDestinations,
    findNearestStack,
    findNode,
    pop,
    popTo,
    popToRoot,
    push,
    replaceTop,
    resolveActivePath,
    selectColumn,
    selectTab,
    setVisibility,
    visibleSplitColumns,
} from "./operations";
```

- [ ] **Step 4：跑测试，确认通过**

Run: `vp test packages/core/test/navigation/operations.test.ts`
Expected: PASS（含新增 5 个 `collectAllLeaves` 用例）。

- [ ] **Step 5：提交**

```bash
git add packages/core/src/navigation/operations.ts packages/core/src/navigation/index.ts packages/core/test/navigation/operations.test.ts
git commit -m "feat(core): add collectAllLeaves — 收集树中全部存在叶子（含不可见）"
```

---

## Task 2：`collectLeafKeys` 复用 `collectAllLeaves`（DRY 重构）

session 的 `collectLeafKeys` 与新 `collectAllLeaves` 是同一遍历，只差「返回 key 字符串」。改为委派，去重。**纯重构**——现有 session 测试须原样通过。

**Files:**
- Modify: `packages/core/src/session/scoped-state.ts`
- Test（回归，不新增）：`packages/core/test/session/scoped-state.test.ts`、`packages/core/test/session/navigation-adapter.test.ts`

- [ ] **Step 1：改 `collectLeafKeys` 为委派**

`packages/core/src/session/scoped-state.ts` 顶部 import：删除 `isLeafNode, isSplitNode, isStackNode, isTabsNode`（refactor 后不再用），改为从 operations 引入 `collectAllLeaves`。把原 import 行：

```ts
import { isLeafNode, isSplitNode, isStackNode, isTabsNode } from "../navigation/nodes";
import type { NavigationNode } from "../navigation";
```

替换为：

```ts
import { collectAllLeaves } from "../navigation/operations";
import type { NavigationNode } from "../navigation";
```

把 `collectLeafKeys` 函数体（含其上方说明 leaf/stack/tabs/split 递归的注释）替换为：

```ts
/**
 * 收集导航树中**全部 leaf** 的身份键（含不可见 / 未激活分支 / 各 split 列）。
 * 委派给 `collectAllLeaves`（同一「全部存在」遍历），映射成 entryKey。
 * 「全部存在」而非「可见」，用于 scoped 状态保留。
 */
export function collectLeafKeys(tree: NavigationNode): string[] {
    return collectAllLeaves(tree).map((l) => sessionEntryKey(l.intent, l.params));
}
```

- [ ] **Step 2：跑 session 测试，确认仍全绿（纯重构）**

Run: `vp test packages/core/test/session`
Expected: PASS —— `scoped-state.test.ts`（含 `collectLeafKeys` 的精确顺序断言 `:22`/`:27` 与 `.sort()` 断言）、`navigation-adapter.test.ts`、`session-store.test.ts`、`snapshot.test.ts` 全过。顺序一致由 `collectAllLeaves` 的「栈按序 / tabs Object.values 序 / 列按序」保证。

- [ ] **Step 3：scoped 校验（类型 + lint）**

Run: `vp check packages/core/src packages/core/test`
Expected: PASS（无 unused import 报错——已删除 4 个 guard import；无类型错）。

- [ ] **Step 4：提交**

```bash
git add packages/core/src/session/scoped-state.ts
git commit -m "refactor(core): collectLeafKeys 复用 collectAllLeaves，去重遍历"
```

---

## Task 3：控制器按条目页面缓存（核心改动 + 更新既有测试）

`resolveTree` 改用持久化的 `pageCache`，使 pop/切 tab 回到仍在树中的条目复用缓存、不重 dispatch（守卫照常跑）。**3 个既有测试断言的是被本特性改掉的「重 fetch」行为，须更新为新行为（RED），再实现（GREEN）。**

**Files:**
- Modify: `packages/core/src/navigation/controller.ts`
- Test: `packages/core/test/navigation/controller.test.ts`（更新 3 个既有用例 + 新增 2 个）

- [ ] **Step 1：更新既有测试 + 新增缓存语义测试（先写期望 = RED）**

在 `controller.test.ts`：

**(a)** 顶部为新增测试引入 `sessionEntryKey`（Task 5 也用；现在先加好，放在已有 import 之后）：

```ts
import { sessionEntryKey } from "../../src/session/scoped-state";
```

**(b)** 替换 `:160` 的用例（`describe("stack operations")` 内，原名 `pop drops the top entry; the now-visible root is newly-visible → re-dispatched`）。把整个 `test(...)` 块替换为：

```ts
    test("pop reveals the still-present root from cache without re-dispatching", async () => {
        const calls: string[] = [];
        const controller = stackController(calls);
        await controller.resolve();
        await controller.push("detail");

        const snap = await controller.pop();

        // root 自始至终在树中（stack 底）→ 首屏已 dispatch 并缓存 → pop 复用、不重 fetch。
        expect(calls).toEqual(["root", "detail"]);
        expect(snap.destinations).toHaveLength(1);
        expect(snap.destinations[0].intent).toBe("root");
        expect(snap.tree).toEqual(stack([leaf("root")]));
    });
```

**(c)** 更新 `:282` 用例（`describe("tabs")` 内 `selectTab switches active branch and dispatches the new one`）的「切回 home」断言。把：

```ts
        // 切回 home：home 不在「上一」快照（只有 profile）→ 重新可见 → 重新 dispatch
        const back = await controller.selectTab("home");
        expect(calls).toEqual(["home", "profile", "home"]);
        expect(back.destinations[0].intent).toBe("home");
```

替换为：

```ts
        // 切回 home：home 分支自始至终在 tabs 树中 → 缓存复用、不重 dispatch。
        const back = await controller.selectTab("home");
        expect(calls).toEqual(["home", "profile"]);
        expect(back.destinations[0].intent).toBe("home");
```

**(d)** 替换 `:741` 用例（`describe("prefetched reuse")` 内 `prefetched is one-shot: a second resolve of a changed-back destination re-dispatches`）整块为：

```ts
    test("a popped-back present entry reuses its cached page (prefetched result included), no re-dispatch", async () => {
        const calls: string[] = [];
        const dispatcher = makeDispatcher(
            { home: (p) => pageFor("home", p), other: (p) => pageFor("other", p) },
            calls,
        );
        const prefetched = PrefetchedIntents.fromArray([
            { intent: { id: "home", params: {} }, data: { id: "h", pageType: "home", title: "S" } },
        ]);
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: stack(leaf("home")),
                prefetched,
            }),
        );

        await controller.resolve(); // home 来自预取（消费 + 缓存），calls=[]
        await controller.push("other"); // calls=[other]；home 仍在树（栈底）
        const snap = await controller.pop(); // 揭示 home：复用缓存、不重 dispatch

        expect(calls).toEqual(["other"]);
        expect(snap.destinations[0].intent).toBe("home");
        expect(snap.destinations[0].page.title).toBe("S"); // 复用的是 SSR 预取页
    });
```

**(e)** 在 `describe("stack operations")` 末尾（最后一个 `test` 之后、`describe` 闭合 `});` 之前）新增两个用例：

```ts
    test("revealing a cached entry re-runs guards but does NOT re-dispatch", async () => {
        const dispatchCalls: string[] = [];
        const guardCalls: string[] = [];
        const guard: BeforeLoadGuard = (ctx: NavigationContext) => {
            guardCalls.push(ctx.intent.id);
            return next();
        };
        const dispatcher = makeDispatcher(
            { root: (p) => pageFor("root", p), detail: (p) => pageFor("detail", p) },
            dispatchCalls,
        );
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: stack(leaf("root")),
                beforeLoad: [guard],
            }),
        );
        await controller.resolve(); // dispatch root；guard[root]
        await controller.push("detail"); // dispatch detail；guard[detail]
        dispatchCalls.length = 0;
        guardCalls.length = 0;

        await controller.pop(); // 揭示 root

        expect(guardCalls).toEqual(["root"]); // 守卫照常跑（安全语义不变）
        expect(dispatchCalls).toEqual([]); // 但不重 fetch（复用缓存页）
    });

    test("an entry removed from the tree then re-added is re-dispatched (cache pruned on leave)", async () => {
        const calls: string[] = [];
        const dispatcher = makeDispatcher(
            { home: (p) => pageFor("home", p), other: (p) => pageFor("other", p) },
            calls,
        );
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: stack(leaf("home")) }),
        );
        await controller.resolve(); // [home]
        await controller.replaceTop("other"); // home 离树 → 缓存 prune；[other]
        await controller.replaceTop("home"); // home 重新入树、未缓存 → 重新 dispatch

        expect(calls).toEqual(["home", "other", "home"]);
    });
```

> 说明：`BeforeLoadGuard`、`NavigationContext`、`next`、`pageFor`、`makeDispatcher`、`makeOptions`、`stackController` 均已在该测试文件顶部定义/导入（见文件现状），直接使用。

- [ ] **Step 2：跑测试，确认失败（RED）**

Run: `vp test packages/core/test/navigation/controller.test.ts`
Expected: FAIL —— 现实现仍按旧「重 dispatch」语义：
- `pop reveals the still-present root...` 实际得到 `["root","detail","root"]`，期望 `["root","detail"]`。
- tabs 切回 home 实际 `["home","profile","home"]`。
- `revealing a cached entry...` 实际 `dispatchCalls=["root"]`、`guardCalls=["root"]`（期望 dispatch 为空）。
- `...prefetched result...` 实际 `["other","home"]`。
- 新增 eviction 用例此时**应已通过**（旧实现对 replaceTop 出树也会重 dispatch）。

- [ ] **Step 3：实现页面缓存**

在 `packages/core/src/navigation/controller.ts`：

**(a)** 在 operations import（约 line 41-53）加入 `collectAllLeaves`：

```ts
import {
    collectAllLeaves,
    collectVisibleDestinations,
    findNode,
    pop,
    popTo,
    popToRoot,
    push,
    replaceTop,
    resolveActivePath,
    selectColumn,
    selectTab,
    setVisibility,
} from "./operations";
```

**(b)** 在状态声明处（`let tree...` 一带，约 line 314-322）新增缓存 Map，并删除 `resolvedOnce`（重写后不再需要）。把：

```ts
    let tree: NavigationNode = options.initial;
    let snapshot: NavigationSnapshot = { tree, destinations: [] };
    let resolvedOnce = false;
    const listeners = new Set<(snapshot: NavigationSnapshot) => void>();
```

替换为：

```ts
    let tree: NavigationNode = options.initial;
    let snapshot: NavigationSnapshot = { tree, destinations: [] };
    const listeners = new Set<(snapshot: NavigationSnapshot) => void>();

    // 按条目身份键缓存已成功解析的目标（ResolvedDestination）。
    // 复用源 = 此缓存（超集：含上一快照 + 所有仍在树中的已解析条目）。
    // 每轮提交后写穿（仅 status===undefined 的成功页）并按 collectAllLeaves prune：
    // 条目离树（pop 掉、tab 分支销毁）→ 其缓存清除（与作用域状态同一生命周期）。
    const pageCache = new Map<string, ResolvedDestination>();
```

**(c)** 重写 `resolveTree`（约 line 342-387）。把原 doc 注释 + 函数整体替换为：

```ts
    /**
     * 解析 `nextTree` 的全部可见目标，返回新快照（纯计算 + 读写 pageCache，不改 `tree`/`snapshot`）。
     *
     * - 复用：可见目标命中 `pageCache` 时，主目标把缓存页喂给 `resolvePrimary`（守卫照常跑、
     *   跳过 dispatch），次目标直接复用缓存结果。
     * - 写穿：本轮解析出的**成功**目标（`status===undefined`）写入缓存；失败/deny/redirect
     *   目标不缓存（并清除其旧缓存），保证下次 reveal 重试 + 不复用错误页。
     * - prune：按 `collectAllLeaves(nextTree)`（全部存在条目）裁剪，离树条目缓存清除。
     */
    async function resolveTree(nextTree: NavigationNode): Promise<NavigationSnapshot> {
        const visible = collectVisibleDestinations(nextTree);

        // 主目标 = 激活路径末端的 leaf（与现有 runner 的「单页」对齐）。
        const activeLeaf = findActiveLeaf(nextTree);
        const primaryKey = activeLeaf
            ? destinationKey(activeLeaf.intent, activeLeaf.params)
            : undefined;

        const destinations: ResolvedDestination[] = [];

        for (const dest of visible) {
            const key = destinationKey(dest.intent, dest.params);
            const isPrimary = primaryKey !== undefined && key === primaryKey;
            const cached = pageCache.get(key);

            if (isPrimary) {
                // 主目标始终跑守卫；命中缓存时把缓存页喂入 → 跳过 dispatch（不重 fetch）。
                destinations.push(await resolvePrimary(dest, cached?.page));
            } else if (cached !== undefined) {
                // 非主、已缓存：直接复用（不 dispatch、不跑守卫）。
                destinations.push(cached);
            } else {
                // 非主、未缓存：仅 dispatch（含 prefetched 复用），无守卫。
                destinations.push(await resolveSecondary(dest));
            }
        }

        // 写穿 + prune。
        for (const d of destinations) {
            const k = destinationKey(d.intent, d.params);
            if (d.status === undefined) {
                pageCache.set(k, d);
            } else {
                pageCache.delete(k); // 失败/deny/redirect 不缓存，清旧缓存避免复用错误页。
            }
        }
        const presentKeys = new Set(
            collectAllLeaves(nextTree).map((l) => destinationKey(l.intent, l.params)),
        );
        for (const k of pageCache.keys()) {
            if (!presentKeys.has(k)) pageCache.delete(k);
        }

        return { tree: nextTree, destinations };
    }
```

**(d)** `commit`（约 line 536-544）里删除 `resolvedOnce = true;` 一行：

```ts
    function commit(next: NavigationSnapshot): NavigationSnapshot {
        tree = next.tree;
        snapshot = next;
        for (const listener of listeners) {
            listener(snapshot);
        }
        return snapshot;
    }
```

**(e)** `apply`（约 line 582-589）的 `resolveTree(nextTree, snapshot)` 改为 `resolveTree(nextTree)`：

```ts
    function apply(op: NavigationOperation): Promise<NavigationSnapshot> {
        return enqueue(async () => {
            const nextTree = computeNextTree(op);
            const next = await resolveTree(nextTree);
            return commit(next);
        });
    }
```

**(f)** `resolve()`（约 line 640-650）简化——删除 `base`/`resolvedOnce` 逻辑：

```ts
        resolve() {
            // resolve() 对当前树做解析；缓存为空时全部 dispatch，非空时复用仍在树中的条目。
            // 与 apply 共用串行队列，避免 resolve 与并发 apply 互相覆盖。
            return enqueue(async () => {
                const next = await resolveTree(tree);
                return commit(next);
            });
        },
```

- [ ] **Step 4：跑测试，确认通过（GREEN）**

Run: `vp test packages/core/test/navigation/controller.test.ts`
Expected: PASS —— 全部用例通过（含更新后的 3 个 + 新增 2 个）。特别验证：`split column reused`（`:176`）、`setVisibility` 系列（`:1091`/`:1116`）等依赖复用的用例仍绿（`collectAllLeaves` 不按可见性裁剪，列内容仍在 → 缓存保留）。

- [ ] **Step 5：提交**

```bash
git add packages/core/src/navigation/controller.ts packages/core/test/navigation/controller.test.ts
git commit -m "feat(core): 控制器按条目缓存页面——pop/切 tab 复用不重 fetch，守卫仍跑"
```

---

## Task 4：`invalidate` / `refresh`（opt-in 取新鲜数据）

默认即时复用缓存；需要新数据时由应用显式触发。`invalidate` 清缓存（指定键或全部），`refresh` 清当前激活叶子缓存并重解析当前树。

**Files:**
- Modify: `packages/core/src/navigation/controller.ts`（接口 + 返回对象）
- Test: `packages/core/test/navigation/controller.test.ts`（新增 describe 块）

- [ ] **Step 1：写失败测试**

在 `controller.test.ts` 末尾追加（`sessionEntryKey` 已在 Task 3 Step 1 导入）：

```ts
// =====================================================================
// invalidate / refresh：opt-in 取新鲜数据
// =====================================================================

describe("invalidate / refresh", () => {
    test("refresh 重新 dispatch 当前激活叶子（清其缓存 + 重解析）", async () => {
        const calls: string[] = [];
        const dispatcher = makeDispatcher({ home: (p) => pageFor("home", p) }, calls);
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: stack(leaf("home")) }),
        );
        await controller.resolve(); // [home]

        const snap = await controller.refresh();

        expect(calls).toEqual(["home", "home"]); // active leaf 重新 dispatch
        expect(snap.destinations[0].intent).toBe("home");
    });

    test("invalidate(entryKey) 使该条目下次 reveal 时重新 dispatch", async () => {
        const calls: string[] = [];
        const dispatcher = makeDispatcher(
            { root: (p) => pageFor("root", p), detail: (p) => pageFor("detail", p) },
            calls,
        );
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: stack(leaf("root")) }),
        );
        await controller.resolve();
        await controller.push("detail");

        controller.invalidate(sessionEntryKey("root", {})); // 清 root 缓存
        await controller.pop(); // root 被 invalidate → 重新 dispatch（而非复用）

        expect(calls).toEqual(["root", "detail", "root"]);
    });

    test("invalidate() 无参清空整个缓存", async () => {
        const calls: string[] = [];
        const dispatcher = makeDispatcher(
            { root: (p) => pageFor("root", p), detail: (p) => pageFor("detail", p) },
            calls,
        );
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: stack(leaf("root")) }),
        );
        await controller.resolve();
        await controller.push("detail");

        controller.invalidate(); // 清全部
        await controller.pop();

        expect(calls).toEqual(["root", "detail", "root"]);
    });
});
```

- [ ] **Step 2：跑测试，确认失败**

Run: `vp test packages/core/test/navigation/controller.test.ts -t "invalidate / refresh"`
Expected: FAIL —— `controller.invalidate is not a function` / `controller.refresh is not a function`。

- [ ] **Step 3：实现 `invalidate` / `refresh`**

在 `packages/core/src/navigation/controller.ts`：

**(a)** `NavigationController` 接口（约 line 264-269，`hydrate` 之后、`subscribe` 之前）新增：

```ts
    /** 用外部树替换当前树并重解析（history/URL 还原）。 */
    hydrate(tree: NavigationNode): Promise<NavigationSnapshot>;
    /**
     * 清除页面缓存：给 `entryKey`（= `sessionEntryKey(intent, params)`）清单个，
     * 不传清全部。仅清缓存、不触发重解析——该条目下次被解析时重新 dispatch。
     */
    invalidate(entryKey?: string): void;
    /** 清当前激活叶子的缓存并重解析当前树（「下拉刷新」式：守卫跑、数据重 fetch）。 */
    refresh(): Promise<NavigationSnapshot>;
    /** 订阅快照变更；返回取消订阅函数。 */
    subscribe(listener: (snapshot: NavigationSnapshot) => void): () => void;
```

**(b)** 返回对象里（约 line 631-633，`hydrate` 之后）新增两个方法实现：

```ts
        hydrate(nextTree) {
            return apply({ kind: NAVIGATION_OP_KINDS.HYDRATE, tree: nextTree });
        },
        invalidate(entryKey) {
            if (entryKey === undefined) {
                pageCache.clear();
            } else {
                pageCache.delete(entryKey);
            }
        },
        refresh() {
            return enqueue(async () => {
                const active = findActiveLeaf(tree);
                if (active) {
                    pageCache.delete(destinationKey(active.intent, active.params));
                }
                const next = await resolveTree(tree);
                return commit(next);
            });
        },
```

- [ ] **Step 4：跑测试，确认通过**

Run: `vp test packages/core/test/navigation/controller.test.ts -t "invalidate / refresh"`
Expected: PASS（3 个用例）。

- [ ] **Step 5：提交**

```bash
git add packages/core/src/navigation/controller.ts packages/core/test/navigation/controller.test.ts
git commit -m "feat(core): 新增 controller.invalidate / refresh —— opt-in 取新鲜数据"
```

---

## Task 5：Phase 1 整体验证

- [ ] **Step 1：跑 core 全量测试**

Run: `vp test packages/core`
Expected: PASS —— 全部 core 测试绿（navigation + session + 其余）。重点确认无回归：`controller.test.ts`、`operations.test.ts`、`scoped-state.test.ts`、`navigation-adapter.test.ts`。

- [ ] **Step 2：scoped 类型 + lint 校验**

Run: `vp check packages/core/src packages/core/test`
Expected: PASS —— 无类型错、无 lint 错（含 unused import）。

- [ ] **Step 3：（可选）跨包编译确认未破坏下游**

Run: `vp test packages/browser packages/ssr`
Expected: PASS —— browser/ssr 通过 `@finesoft/core` 用到 controller/operations 的部分未受签名变更影响（`resolveTree` 是内部函数，对外 API 仅**新增** `invalidate`/`refresh`，无破坏）。若 ssr/browser 有引用 `resolveTree` 的（不应有，它非导出）则修正。

---

## Phase 1 完成定义（DoD）

- `collectAllLeaves` 落地并导出；`collectLeafKeys` 委派之、session 测试全绿。
- 控制器按条目缓存：pop / 切 tab / setVisibility 回到仍在树中的条目复用缓存、**不重 dispatch**，主目标**守卫仍跑**；离树条目缓存随 `collectAllLeaves` prune 清除；失败页不缓存。
- `invalidate` / `refresh` 可用且测试覆盖。
- `vp test packages/core` 与 `vp check packages/core/src packages/core/test` 全绿。
- 提交分布在 4 个语义提交里（Task 1/2/3/4 各一），都在 `feat/session-restoration`。

## 自审记录（spec 覆盖 / 占位 / 类型一致）

- **spec 覆盖**：本计划覆盖 spec §3（`collectAllLeaves`）、§4.4（控制器页面缓存 + 守卫仍跑 + prune + `invalidate`/`refresh`）、§8 core 段（operations/controller/scoped-state 改动）。§4.0/§4.1/§4.2/§4.3/§4.5（islands、detach、chrome、重载层）与 §8 browser/front/template 段、flat 隐式栈——**留待后续 Phase 计划**（见下）。
- **占位扫描**：无 TBD/TODO；每个改代码步骤都给了完整代码与精确 import/行号锚点。
- **类型一致**：`pageCache: Map<string, ResolvedDestination>`、`destinationKey`（私有，已存在）、`sessionEntryKey`（测试侧用，公开导出）、`collectAllLeaves(tree): readonly LeafNode[]`、`invalidate(entryKey?: string): void`、`refresh(): Promise<NavigationSnapshot>` —— 跨任务签名一致。

## 后续 Phase（各自独立计划，本计划完成并验证后再写，届时对 browser 实际状态做侦察）

- **Phase 2 — islands 编排器**（`@finesoft/browser`）：`mountEntry` 契约、outlet + 结构容器树、attach/detach（detach=出 document）、`fs:*` 生命周期事件、滚动 conceal/reveal 捕获重放。依赖 Phase 1。
- **Phase 3 — 重载层**：自动 DOM 子集捕获/恢复（`data-restore-root`、排除 password、合成事件），接入 session 快照。
- **Phase 4 — flat 隐式单栈**：flat FlowAction handler 在有 `mountEntry` 时驱动隐式栈编排器。
- **Phase 5 — vue-minimal 重构**：拆 chrome / island 视图，删手写 scoped 样板，加 `data-restore-root`。
- 各 Phase 完成后 changeset：`@finesoft/front: minor`。
