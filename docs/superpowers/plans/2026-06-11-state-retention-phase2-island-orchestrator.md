# 会话恢复完整实现 · Phase 2：islands 编排器（@finesoft/browser）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `@finesoft/browser` 增加 opt-in 的「islands」挂载模型：应用提供通用原语 `mountEntry(entry, container)`，框架按 per-entry 把视图挂为独立 root，并按导航 present/visible 集管理生命周期——首次可见即挂载、present-但-不可见即 **detach（出 document）保活**、离树即 unmount。在 container 上派发 `fs:*` 生命周期事件，并在 conceal/reveal 捕获重放滚动。这是 spec §4.0/§4.1/§4.2 的核心新增。

**Architecture:** 新增纯模块 `navigation-islands.ts`，导出 `createIslandOrchestrator`。编排器的核心是 `sync(snapshot)`：用 `collectAllLeaves(tree)` 算 present 集、`snapshot.destinations` 为 visible 集（含 page），diff 内部 `Map<entryKey, MountedIsland>`：新可见条目 `mountEntry` 一次并记录；离 present 集的 unmount；present-但-不可见的 detach（节点 `remove()` 出 document，实例保留）；可见的按序 attach 进 outlet。保活逻辑全在编排器，适配器只提供 `mountEntry`/`unmount` 这一跨框架一致原语（Vue/React/Svelte 均有）。`start-app.ts` 的 `navigation` 配置加可选 `mountEntry`；提供时 `activateNavigation` 在首屏 resolve 后从 `[data-fs-outlet]` 取 outlet、建编排器、订阅 controller 快照驱动 `sync`。

**Tech Stack:** TypeScript（strict）、Vite+（`vp test`/`vp check`）、Vitest（`vite-plus/test`，jsdom 环境）。仅改 `@finesoft/browser`（+ `front` 再导出）。依赖 Phase 1 的 `collectAllLeaves`。

**落地分支：** `feat/session-restoration`。**全局约定**同 Phase 1（`vp test <file>`、`vp check packages/browser/src packages/browser/test`、从 `vite-plus`/`vite-plus/test` 导入、中文 conventional commit、只 add 本任务文件）。

**前置检查（Task 1 Step 0 前确认）：** `collectAllLeaves` 与 `sessionEntryKey` 须从 `@finesoft/core` 顶层可导入。Phase 1 已把 `collectAllLeaves` 加到 `packages/core/src/navigation/index.ts`；`sessionEntryKey` 在 `packages/core/src/session/scoped-state.ts`。确认 `packages/core/src/index.ts` 顶层 barrel 已 re-export 二者（结构化导航/会话已导出 `sessionEntryKey`、`collectVisibleDestinations` 等同级符号，缺 `collectAllLeaves` 则在对应 barrel 行补上）。验证：`vp test packages/browser`（下方 import 不报 `has no exported member`）。

---

## Task 1：编排器核心生命周期（mount-once / unmount-on-leave / detach-hide / attach-show）

**Files:**

- Create: `packages/browser/src/navigation-islands.ts`
- Test: `packages/browser/test/navigation-islands.test.ts`

- [ ] **Step 1：写失败测试**

新建 `packages/browser/test/navigation-islands.test.ts`：

```ts
import { describe, expect, test } from "vite-plus/test";
import {
    leaf,
    sessionEntryKey,
    stack,
    tabs,
    type BasePage,
    type NavigationSnapshot,
    type ResolvedDestination,
} from "@finesoft/core";
import {
    createIslandOrchestrator,
    type IslandHandle,
    type MountEntry,
    type ResolvedEntry,
} from "../src/navigation-islands";

/** 构造一个 ResolvedDestination（page 用 intent 编进去，方便断言）。 */
function dest(intent: string, params: Record<string, unknown> = {}): ResolvedDestination {
    return { intent, params, page: { id: intent, pageType: intent, title: intent } as BasePage };
}

/** 记录所有 mountEntry / unmount 调用 + 把 entryKey 写进 container 供 DOM 断言。 */
function makeMountEntry(events: string[]): MountEntry {
    return (entry: ResolvedEntry, container: HTMLElement): IslandHandle => {
        events.push(`mount:${entry.entryKey}`);
        container.setAttribute("data-key", entry.entryKey);
        container.textContent = entry.page.title ?? "";
        return {
            unmount(): void {
                events.push(`unmount:${entry.entryKey}`);
            },
        };
    };
}

/** 该 outlet 内当前 attached（在 document 里）的 island 的 data-key，按 DOM 序。 */
function attachedKeys(outlet: HTMLElement): string[] {
    return [...outlet.querySelectorAll("[data-fs-entry]")].map(
        (el) => el.getAttribute("data-key") ?? "",
    );
}

const KEY = (intent: string, params: Record<string, unknown> = {}): string =>
    sessionEntryKey(intent, params);

describe("island orchestrator — 生命周期", () => {
    test("首屏可见目标各 mountEntry 一次并 attach 进 outlet", () => {
        const events: string[] = [];
        const outlet = document.createElement("div");
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry(events) });

        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });

        expect(events).toEqual([`mount:${KEY("home")}`]);
        expect(attachedKeys(outlet)).toEqual([KEY("home")]);
    });

    test("push 新目标：仅新目标 mountEntry，底层条目仍挂载但 detach（出 outlet）", () => {
        const events: string[] = [];
        const outlet = document.createElement("div");
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry(events) });

        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });
        events.length = 0;

        // push detail：tree=[home,detail]，可见=[detail]，home 仍 present 但不可见。
        o.sync({ tree: stack([leaf("home"), leaf("detail")]), destinations: [dest("detail")] });

        expect(events).toEqual([`mount:${KEY("detail")}`]); // home 不重挂、不 unmount（保活）
        expect(attachedKeys(outlet)).toEqual([KEY("detail")]); // home detach 出 document
    });

    test("pop 回 home：复用 home 的活实例（不重挂、不 unmount），detail 仍 present→保活 detach", () => {
        const events: string[] = [];
        const outlet = document.createElement("div");
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry(events) });

        o.sync({ tree: stack([leaf("home"), leaf("detail")]), destinations: [dest("detail")] });
        // 注意：上一步 home 从未可见过 → 未挂载。先让 home 可见一次再 push，模拟真实路径。
        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] }); // home 挂载
        o.sync({ tree: stack([leaf("home"), leaf("detail")]), destinations: [dest("detail")] }); // detail 挂载，home detach
        events.length = 0;

        // pop：tree=[home]，可见=[home]。home 仍在 mounted → 复用 + 重 attach；detail 离树 → unmount。
        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });

        expect(events).toEqual([`unmount:${KEY("detail")}`]); // detail 离树 unmount；home 不重挂
        expect(attachedKeys(outlet)).toEqual([KEY("home")]); // home 重 attach
    });

    test("split 多可见目标：按 destinations 顺序 attach 为 outlet 的有序子节点", () => {
        const events: string[] = [];
        const outlet = document.createElement("div");
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry(events) });

        o.sync({
            tree: stack([leaf("x")]), // tree 形态不影响：present 由 collectAllLeaves 取，可见由 destinations 定
            destinations: [dest("list"), dest("detail")],
        });
        // 但 present 集来自 tree（这里 tree 只有 x）——list/detail 不在 present 集会被立刻 unmount。
        // 因此用一个真实 split 形态的树：
        o.sync({
            tree: {
                kind: "split",
                columns: [
                    { id: "l", content: leaf("list") },
                    { id: "d", content: leaf("detail") },
                ],
            } as NavigationSnapshot["tree"],
            destinations: [dest("list"), dest("detail")],
        });

        expect(attachedKeys(outlet)).toEqual([KEY("list"), KEY("detail")]);
    });

    test("离树条目 unmount：tabs 切到只剩另一分支可见时，旧可见叶子仍 present（保活），真正离树才 unmount", () => {
        const events: string[] = [];
        const outlet = document.createElement("div");
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry(events) });

        const tree = tabs({
            active: "home",
            branches: { home: leaf("home"), notes: leaf("notes") },
        });
        o.sync({ tree, destinations: [dest("home")] }); // home 挂载
        o.sync({
            tree: tabs({ active: "notes", branches: { home: leaf("home"), notes: leaf("notes") } }),
            destinations: [dest("notes")],
        });
        // 切到 notes：home 分支仍在 tabs 树中（present）→ home 保活 detach，不 unmount；notes 挂载。
        expect(events).toEqual([`mount:${KEY("home")}`, `mount:${KEY("notes")}`]);
        expect(attachedKeys(outlet)).toEqual([KEY("notes")]);
    });

    test("dispose：unmount 全部 island 并清空 outlet", () => {
        const events: string[] = [];
        const outlet = document.createElement("div");
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry(events) });
        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });
        events.length = 0;

        o.dispose();

        expect(events).toEqual([`unmount:${KEY("home")}`]);
        expect(outlet.children).toHaveLength(0);
    });
});
```

- [ ] **Step 2：跑测试，确认失败**

Run: `vp test packages/browser/test/navigation-islands.test.ts`
Expected: FAIL —— `navigation-islands` 模块不存在 / `createIslandOrchestrator` 未导出。

- [ ] **Step 3：实现编排器核心**

新建 `packages/browser/src/navigation-islands.ts`：

```ts
/**
 * Island 编排器 —— opt-in 的 per-entry 挂载模型（spec §4.1/§4.2）。
 *
 * 应用提供 `mountEntry(entry, container) => { unmount }`（Vue/React/Svelte 通用原语）。
 * 编排器按导航 present/visible 集管理生命周期：
 * - 首次可见 → `mountEntry` 一次（实例诞生）。
 * - present 但不可见 → **detach**（container.remove()，出 document，实例保活）。
 * - 可见 → attach 进 outlet（按 destinations 顺序）。
 * - 离 present 集（pop 掉 / tab 分支销毁）→ `unmount()`。
 *
 * 「隐藏=detach」：节点出 document，devtools/全局 querySelector 看不到、屏间真隔离；
 * 代价是背景媒体暂停、滚动需重放（见 Task 3）。
 */

import {
    collectAllLeaves,
    sessionEntryKey,
    type BasePage,
    type NavigationSnapshot,
    type RouteParams,
} from "@finesoft/core";

/** 交给 `mountEntry` 的单条目解析结果。 */
export interface ResolvedEntry {
    readonly intent: string;
    readonly params: RouteParams;
    readonly entryKey: string;
    readonly page: BasePage;
}

/** `mountEntry` 返回的 island 句柄。 */
export interface IslandHandle {
    /** 销毁该 island 实例（应用用 app.unmount() / root.unmount() / comp.$destroy() 实现）。 */
    unmount(): void;
}

/** 通用挂载原语：把一个条目的视图挂进 container，返回卸载句柄。 */
export type MountEntry = (entry: ResolvedEntry, container: HTMLElement) => IslandHandle;

/** `createIslandOrchestrator` 选项。 */
export interface IslandOrchestratorOptions {
    /** 框架在其内构建/挂载 island 容器的 outlet 元素（应用渲染、稳定、空）。 */
    readonly outlet: HTMLElement;
    /** 应用提供的挂载原语。 */
    readonly mountEntry: MountEntry;
}

/** 编排器对外面。 */
export interface IslandOrchestrator {
    /** 把 DOM 同步到一个导航快照（挂新/卸离树/detach 隐藏/attach 可见）。 */
    sync(snapshot: NavigationSnapshot): void;
    /** 卸载全部 island、清空 outlet。 */
    dispose(): void;
}

/** 一个已挂载 island 的内部记录。 */
interface MountedIsland {
    readonly container: HTMLElement;
    readonly handle: IslandHandle;
    /** 当前是否 attached（在 document 里 = 可见）。 */
    attached: boolean;
}

export function createIslandOrchestrator(options: IslandOrchestratorOptions): IslandOrchestrator {
    const { outlet, mountEntry } = options;
    const mounted = new Map<string, MountedIsland>();

    function conceal(island: MountedIsland): void {
        if (!island.attached) return;
        island.container.remove(); // 出 document（保活，实例不销毁）
        island.attached = false;
    }

    function teardown(key: string, island: MountedIsland): void {
        conceal(island);
        island.handle.unmount();
        mounted.delete(key);
    }

    function sync(snapshot: NavigationSnapshot): void {
        const presentKeys = new Set(
            collectAllLeaves(snapshot.tree).map((l) => sessionEntryKey(l.intent, l.params)),
        );

        // 1) 卸载离 present 集的 island。
        for (const [key, island] of mounted) {
            if (!presentKeys.has(key)) teardown(key, island);
        }

        // 2) 确保每个可见目标已挂载（首次可见才挂），并按序 attach。
        const visibleKeys: string[] = [];
        for (const d of snapshot.destinations) {
            const key = sessionEntryKey(d.intent, d.params);
            visibleKeys.push(key);
            if (!mounted.has(key)) {
                const container = document.createElement("div");
                container.setAttribute("data-fs-entry", "");
                container.setAttribute("data-fs-intent", d.intent);
                container.setAttribute("data-fs-key", key);
                const entry: ResolvedEntry = {
                    intent: d.intent,
                    params: d.params,
                    entryKey: key,
                    page: d.page,
                };
                const handle = mountEntry(entry, container);
                mounted.set(key, { container, handle, attached: false });
            }
        }

        // 3) detach 掉 present-但-不可见的 island（保活）。
        const visibleSet = new Set(visibleKeys);
        for (const [key, island] of mounted) {
            if (!visibleSet.has(key)) conceal(island);
        }

        // 4) 按 destinations 顺序 attach/reorder 可见 island（appendChild 已在则移动 → 重排）。
        for (const key of visibleKeys) {
            const island = mounted.get(key);
            if (island === undefined) continue;
            outlet.appendChild(island.container);
            island.attached = true;
        }
    }

    function dispose(): void {
        for (const [key, island] of mounted) teardown(key, island);
    }

    return { sync, dispose };
}
```

- [ ] **Step 4：跑测试，确认通过**

Run: `vp test packages/browser/test/navigation-islands.test.ts`
Expected: PASS（6 个生命周期用例）。

- [ ] **Step 5：提交**

```bash
git add packages/browser/src/navigation-islands.ts packages/browser/test/navigation-islands.test.ts
git commit -m "feat(browser): island 编排器核心——per-entry 挂载/保活 detach/离树 unmount"
```

---

## Task 2：`fs:*` 生命周期事件

在 container 上派发 UI 无关的 `CustomEvent`，供应用监听（暂停视频、自定义恢复等）。`fs:enter`（首次挂载）/ `fs:reveal`（变可见）/ `fs:conceal`（变隐藏）/ `fs:exit`（卸载前）。

**Files:**

- Modify: `packages/browser/src/navigation-islands.ts`
- Test: `packages/browser/test/navigation-islands.test.ts`

- [ ] **Step 1：写失败测试**（在 `navigation-islands.test.ts` 追加 describe 块）

```ts
describe("island orchestrator — fs:* 生命周期事件", () => {
    /** 在 outlet 上委托监听 fs:* 事件（CustomEvent bubbles），记录 type:key。 */
    function listen(outlet: HTMLElement, log: string[]): void {
        for (const type of ["fs:enter", "fs:reveal", "fs:conceal", "fs:exit"]) {
            outlet.addEventListener(type, (e) => {
                const key = (e.target as HTMLElement).getAttribute("data-key") ?? "";
                log.push(`${type}:${key}`);
            });
        }
    }

    test("挂载→可见 派发 enter 然后 reveal", () => {
        const outlet = document.createElement("div");
        const log: string[] = [];
        listen(outlet, log);
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry([]) });

        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });

        expect(log).toEqual([`fs:enter:${KEY("home")}`, `fs:reveal:${KEY("home")}`]);
    });

    test("push 使底层条目 conceal；pop 使其 reveal", () => {
        const outlet = document.createElement("div");
        const log: string[] = [];
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry([]) });
        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });
        listen(outlet, log);

        o.sync({ tree: stack([leaf("home"), leaf("detail")]), destinations: [dest("detail")] });
        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });

        expect(log).toContain(`fs:conceal:${KEY("home")}`);
        expect(log).toContain(`fs:enter:${KEY("detail")}`);
        expect(log).toContain(`fs:reveal:${KEY("home")}`);
        expect(log).toContain(`fs:exit:${KEY("detail")}`); // detail 离树
    });
});
```

- [ ] **Step 2：跑测试，确认失败**

Run: `vp test packages/browser/test/navigation-islands.test.ts -t "fs:\\* 生命周期"`
Expected: FAIL —— 未派发任何 `fs:*` 事件，`log` 为空。

- [ ] **Step 3：实现事件派发**

在 `navigation-islands.ts` 顶部（`createIslandOrchestrator` 内或模块级）加辅助，并在生命周期点派发。模块级加：

```ts
function emit(
    container: HTMLElement,
    type: "fs:enter" | "fs:reveal" | "fs:conceal" | "fs:exit",
): void {
    container.dispatchEvent(new CustomEvent(type, { bubbles: true }));
}
```

改 `conceal`：detach 前派发 `fs:conceal`：

```ts
function conceal(island: MountedIsland): void {
    if (!island.attached) return;
    emit(island.container, "fs:conceal");
    island.container.remove();
    island.attached = false;
}
```

改 `teardown`：unmount 前派发 `fs:exit`：

```ts
function teardown(key: string, island: MountedIsland): void {
    conceal(island);
    emit(island.container, "fs:exit");
    island.handle.unmount();
    mounted.delete(key);
}
```

在 `sync` step 2 新挂载后派发 `fs:enter`：

```ts
const handle = mountEntry(entry, container);
mounted.set(key, { container, handle, attached: false });
emit(container, "fs:enter");
```

在 `sync` step 4 attach 时，仅对「之前未 attached」的派发 `fs:reveal`：

```ts
for (const key of visibleKeys) {
    const island = mounted.get(key);
    if (island === undefined) continue;
    const wasAttached = island.attached;
    outlet.appendChild(island.container);
    island.attached = true;
    if (!wasAttached) emit(island.container, "fs:reveal");
}
```

- [ ] **Step 4：跑测试，确认通过**

Run: `vp test packages/browser/test/navigation-islands.test.ts`
Expected: PASS（含 fs:\* 用例 + 此前生命周期用例不回归）。

- [ ] **Step 5：提交**

```bash
git add packages/browser/src/navigation-islands.ts packages/browser/test/navigation-islands.test.ts
git commit -m "feat(browser): island fs:* 生命周期事件（enter/reveal/conceal/exit）"
```

---

## Task 3：滚动 conceal/reveal 捕获重放

detach 丢的是 layout（`scrollTop` 归零），form 值等 DOM 属性随分离节点留存。编排器在 conceal 时记录可滚动后代的 `scrollTop/scrollLeft`，reveal 时重放（rAF）。

**Files:**

- Modify: `packages/browser/src/navigation-islands.ts`
- Test: `packages/browser/test/navigation-islands.test.ts`

- [ ] **Step 1：写失败测试**（追加 describe；jsdom 下 `scrollTop` 可作普通属性读写，故可断言往返）

```ts
describe("island orchestrator — 滚动 conceal/reveal 往返", () => {
    test("conceal 记录 scrollTop，reveal 重放", () => {
        const outlet = document.createElement("div");
        // mountEntry 在 container 内放一个带 data-fs-scroll 的可滚动元素。
        const mountEntry: MountEntry = (entry, container) => {
            const scroller = document.createElement("div");
            scroller.setAttribute("data-fs-scroll", "");
            container.appendChild(scroller);
            return { unmount() {} };
        };
        // 注入同步 scheduler（替代 rAF）便于断言。
        const o = createIslandOrchestrator({ outlet, mountEntry, schedule: (cb) => cb() });

        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });
        const scroller = outlet.querySelector("[data-fs-scroll]") as HTMLElement;
        scroller.scrollTop = 120;

        // push detail → home conceal（记录 120）
        o.sync({ tree: stack([leaf("home"), leaf("detail")]), destinations: [dest("detail")] });
        // 模拟 detach 期间 scrollTop 归零（真实浏览器行为；jsdom 需手动置 0 验证重放）
        scroller.scrollTop = 0;
        // pop → home reveal → 重放 120
        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });

        expect(scroller.scrollTop).toBe(120);
    });
});
```

- [ ] **Step 2：跑测试，确认失败**

Run: `vp test packages/browser/test/navigation-islands.test.ts -t "滚动"`
Expected: FAIL —— 无 `schedule` 选项 / 无滚动捕获重放，`scrollTop` 仍为 0。

- [ ] **Step 3：实现滚动捕获/重放**

`navigation-islands.ts`：`IslandOrchestratorOptions` 加可选 `schedule`：

```ts
export interface IslandOrchestratorOptions {
    readonly outlet: HTMLElement;
    readonly mountEntry: MountEntry;
    /** 重放调度（默认 requestAnimationFrame；测试可注入同步执行）。 */
    readonly schedule?: (cb: () => void) => void;
}
```

`MountedIsland` 加滚动快照字段：

```ts
interface MountedIsland {
    readonly container: HTMLElement;
    readonly handle: IslandHandle;
    attached: boolean;
    /** conceal 时记录的滚动位置（按可滚动元素序）。 */
    scroll?: { top: number; left: number }[];
}
```

`createIslandOrchestrator` 内取 schedule + 加捕获/重放辅助：

```ts
const schedule =
    options.schedule ??
    ((cb: () => void) => {
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(cb);
        else cb();
    });

/** 容器内全部可滚动元素（含容器自身），按文档序。 */
function scrollables(container: HTMLElement): HTMLElement[] {
    const list: HTMLElement[] = [container];
    for (const el of container.querySelectorAll<HTMLElement>("[data-fs-scroll]")) list.push(el);
    return list;
}

function captureScroll(island: MountedIsland): void {
    island.scroll = scrollables(island.container).map((el) => ({
        top: el.scrollTop,
        left: el.scrollLeft,
    }));
}

function restoreScroll(island: MountedIsland): void {
    const saved = island.scroll;
    if (saved === undefined) return;
    schedule(() => {
        const els = scrollables(island.container);
        saved.forEach((pos, i) => {
            const el = els[i];
            if (el !== undefined) {
                el.scrollTop = pos.top;
                el.scrollLeft = pos.left;
            }
        });
    });
}
```

`conceal` 在 detach 前捕获滚动：

```ts
function conceal(island: MountedIsland): void {
    if (!island.attached) return;
    captureScroll(island);
    emit(island.container, "fs:conceal");
    island.container.remove();
    island.attached = false;
}
```

reveal（attach）后重放：

```ts
const wasAttached = island.attached;
outlet.appendChild(island.container);
island.attached = true;
if (!wasAttached) {
    emit(island.container, "fs:reveal");
    restoreScroll(island);
}
```

- [ ] **Step 4：跑测试，确认通过**

Run: `vp test packages/browser/test/navigation-islands.test.ts`
Expected: PASS。

> 注：真浏览器下「detach 丢 layout 导致 scrollTop 归零」的实际行为留待 Phase 5 的 playwright 验证；jsdom 用手动置 0 模拟，验证重放逻辑本身。

- [ ] **Step 5：提交**

```bash
git add packages/browser/src/navigation-islands.ts packages/browser/test/navigation-islands.test.ts
git commit -m "feat(browser): island conceal/reveal 滚动捕获重放（detach 丢 layout 的兜底）"
```

---

## Task 4：`page` 标识变化 → remount（支持 controller.refresh）

Phase 1 的 `refresh()` 会让某条目重新 dispatch、产出**新 page**。编排器需检测可见条目的 page 引用变化并 remount（拿新 page），否则活 island 收不到新数据。

**Files:**

- Modify: `packages/browser/src/navigation-islands.ts`
- Test: `packages/browser/test/navigation-islands.test.ts`

- [ ] **Step 1：写失败测试**

```ts
describe("island orchestrator — page 变化 remount", () => {
    test("同 entryKey 但 page 引用变化 → unmount 旧 + mount 新", () => {
        const events: string[] = [];
        const outlet = document.createElement("div");
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry(events) });

        const d1 = dest("home");
        o.sync({ tree: stack([leaf("home")]), destinations: [d1] });
        events.length = 0;

        // 同 key、新 page 对象（模拟 refresh 后控制器产出的新页）
        const d2: ResolvedDestination = {
            intent: "home",
            params: {},
            page: { id: "home", pageType: "home", title: "fresh" } as BasePage,
        };
        o.sync({ tree: stack([leaf("home")]), destinations: [d2] });

        expect(events).toEqual([`unmount:${KEY("home")}`, `mount:${KEY("home")}`]);
        expect(outlet.querySelector("[data-fs-entry]")?.textContent).toBe("fresh");
    });

    test("page 引用不变 → 不 remount（保活）", () => {
        const events: string[] = [];
        const outlet = document.createElement("div");
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry(events) });
        const d = dest("home");
        o.sync({ tree: stack([leaf("home")]), destinations: [d] });
        events.length = 0;
        o.sync({ tree: stack([leaf("home")]), destinations: [d] }); // 同一 page 引用
        expect(events).toEqual([]);
    });
});
```

- [ ] **Step 2：跑测试，确认失败**

Run: `vp test packages/browser/test/navigation-islands.test.ts -t "page 变化"`
Expected: FAIL —— 第一个用例无 remount（`events` 为空），`textContent` 仍是旧标题。

- [ ] **Step 3：实现 page 标识比对 remount**

`MountedIsland` 加 `page` 字段（记录挂载时的 page 引用）：

```ts
interface MountedIsland {
    readonly container: HTMLElement;
    readonly handle: IslandHandle;
    attached: boolean;
    page: BasePage;
    scroll?: { top: number; left: number }[];
}
```

`sync` step 2 中，命中已挂载但 page 引用变化时先 teardown 再重挂；记录 page：

```ts
const visibleKeys: string[] = [];
for (const d of snapshot.destinations) {
    const key = sessionEntryKey(d.intent, d.params);
    visibleKeys.push(key);
    const existing = mounted.get(key);
    if (existing !== undefined && existing.page !== d.page) {
        teardown(key, existing); // page 变了（refresh）→ 重挂拿新 page
    }
    if (!mounted.has(key)) {
        const container = document.createElement("div");
        container.setAttribute("data-fs-entry", "");
        container.setAttribute("data-fs-intent", d.intent);
        container.setAttribute("data-fs-key", key);
        const entry: ResolvedEntry = {
            intent: d.intent,
            params: d.params,
            entryKey: key,
            page: d.page,
        };
        const handle = mountEntry(entry, container);
        mounted.set(key, { container, handle, attached: false, page: d.page });
        emit(container, "fs:enter");
    }
}
```

- [ ] **Step 4：跑测试，确认通过**

Run: `vp test packages/browser/test/navigation-islands.test.ts`
Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add packages/browser/src/navigation-islands.ts packages/browser/test/navigation-islands.test.ts
git commit -m "feat(browser): island 在 page 标识变化时 remount（支撑 controller.refresh）"
```

---

## Task 5：接线进 `startBrowserApp` + 导出

`BrowserNavigationConfig` 加可选 `mountEntry`；提供时 `activateNavigation` 在首屏 resolve 后从 `[data-fs-outlet]` 取 outlet、建编排器、首同步 + 订阅 controller 驱动后续 `sync`。

**Files:**

- Modify: `packages/browser/src/start-app.ts`
- Modify: `packages/browser/src/index.ts`
- Test: `packages/browser/test/start-app.test.ts`（追加 islands 接线用例；若该文件无 jsdom DOM 装配，参照其现有用例风格）

- [ ] **Step 1：写失败测试**

在 `packages/browser/test/start-app.test.ts` 追加（装配最小 DOM：`#app` 内含 `[data-fs-outlet]`，mount 渲染 chrome+outlet，提供 `navigation.mountEntry`，断言首屏 island 进 outlet）：

```ts
describe("startBrowserApp — islands（navigation.mountEntry）", () => {
    test("提供 mountEntry：首屏可见目标挂为 outlet 内的 island", async () => {
        document.body.innerHTML = `<div id="app"></div>`;
        const mountCalls: string[] = [];

        await startBrowserApp({
            bootstrap: (fw) => {
                // 注册一个 home controller（参照本文件既有 bootstrap 写法）
                defineRoutes(fw, [
                    {
                        path: "/",
                        intentId: "home",
                        controller: {
                            intentId: "home",
                            execute: () => ({ id: "home", pageType: "home", title: "Home" }),
                        },
                    },
                ]);
            },
            mount: (target) => {
                target.innerHTML = `<header data-chrome></header><main data-fs-outlet></main>`;
                return () => undefined;
            },
            callbacks: { onNavigate() {}, onModal() {} },
            navigation: {
                initial: leaf("home"),
                mountEntry: (entry, container) => {
                    mountCalls.push(entry.entryKey);
                    container.textContent = entry.page.title ?? "";
                    return { unmount() {} };
                },
            },
        });

        const outlet = document.querySelector("[data-fs-outlet]") as HTMLElement;
        expect(mountCalls).toEqual([sessionEntryKey("home", {})]);
        expect(outlet.querySelector("[data-fs-entry]")?.textContent).toBe("Home");
    });
});
```

> 顶部按需引入 `leaf`、`sessionEntryKey`、`defineRoutes`（从 `@finesoft/core`）+ `startBrowserApp`（从 `../src/start-app`）。具体 controller 注册写法对齐该测试文件现有用例。

- [ ] **Step 2：跑测试，确认失败**

Run: `vp test packages/browser/test/start-app.test.ts -t "islands"`
Expected: FAIL —— `BrowserNavigationConfig` 无 `mountEntry`（类型错）/ 无 island 进 outlet（`data-fs-entry` 不存在）。

- [ ] **Step 3：实现接线**

`start-app.ts`：

**(a)** import 编排器：

```ts
import { createIslandOrchestrator, type MountEntry } from "./navigation-islands";
```

**(b)** `BrowserNavigationConfig` 加 `mountEntry`：

```ts
export interface BrowserNavigationConfig {
    readonly initial: NavigationNode;
    readonly codec?: NavigationCodec;
    readonly beforeLoad?: readonly BeforeLoadGuard[];
    readonly afterLoad?: readonly AfterLoadGuard[];
    readonly getErrorPage?: (status: number, message: string) => BasePage;
    /**
     * opt-in islands 挂载原语：提供后框架按 per-entry 把视图挂为独立 root 并保活（见 Phase 2）。
     * 缺省时走原有「单 mount + 应用订阅 snapshot 重渲」路径，不变。
     */
    readonly mountEntry?: MountEntry;
}
```

**(c)** `activateNavigation` 的参数加 `target`，并在 resolve 后建编排器。把 `activateNavigation` 签名与体内末尾改为：

```ts
async function activateNavigation(args: {
    framework: Framework;
    navigation: BrowserNavigationConfig;
    log: Logger;
    target: HTMLElement;
    getScrollablePageElement?: () => HTMLElement | null;
}): Promise<ActivatedNavigation> {
    const { framework, navigation, log, target, getScrollablePageElement } = args;
    // ...（codec / controller / handle 构建保持不变）...

    // 首屏解析：提交首个快照。
    await controller.resolve();

    // opt-in islands：从 outlet 建编排器，首同步 + 订阅后续快照。
    if (navigation.mountEntry) {
        const outlet = target.querySelector<HTMLElement>("[data-fs-outlet]");
        if (!outlet) {
            throw new Error(
                "[startBrowserApp] navigation.mountEntry 已提供，但 mount 渲染的 DOM 里找不到 [data-fs-outlet]。" +
                    "请在 chrome 里放一个稳定、空的 <main data-fs-outlet></main>。",
            );
        }
        const orchestrator = createIslandOrchestrator({
            outlet,
            mountEntry: navigation.mountEntry,
        });
        orchestrator.sync(controller.getSnapshot());
        controller.subscribe((snapshot) => orchestrator.sync(snapshot));
    }

    return { handle, controller };
}
```

**(d)** 调用处（约 line 289-296）把 `target` 传进去：

```ts
let activatedNavigation: ActivatedNavigation | undefined;
if (config.navigation) {
    activatedNavigation = await activateNavigation({
        framework,
        navigation: config.navigation,
        log,
        target,
        getScrollablePageElement: config.getScrollablePageElement,
    });
    await config.onNavigationReady?.(activatedNavigation.handle);
}
```

`index.ts` 导出 islands 公共符号：

```ts
// ===== Navigation Islands =====
export {
    createIslandOrchestrator,
    type IslandHandle,
    type IslandOrchestrator,
    type IslandOrchestratorOptions,
    type MountEntry,
    type ResolvedEntry,
} from "./navigation-islands";
```

- [ ] **Step 4：跑测试，确认通过**

Run: `vp test packages/browser/test/start-app.test.ts -t "islands"`
Expected: PASS。再跑全量 `vp test packages/browser` 确认无回归（既有「单 mount」启动用例不受影响——`mountEntry` 缺省时整段不执行）。

- [ ] **Step 5：scoped 校验 + 提交**

Run: `vp check packages/browser/src packages/browser/test`
Expected: PASS。

```bash
git add packages/browser/src/start-app.ts packages/browser/src/index.ts packages/browser/test/start-app.test.ts
git commit -m "feat(browser): startBrowserApp 接 islands —— navigation.mountEntry opt-in 驱动编排器"
```

---

## Task 6：`front` 再导出 + 全量验证

**Files:**

- Modify: `packages/front/src/index.ts`（或其聚合导出入口；对齐既有再导出 browser 符号的写法）

- [ ] **Step 1：在 front 再导出 islands 符号**

参照 `packages/front` 现有「再导出 `@finesoft/browser` 的 `NavigationHandle`/`startBrowserApp`」处，补 `createIslandOrchestrator`、`MountEntry`、`ResolvedEntry`、`IslandHandle`、`IslandOrchestrator`、`IslandOrchestratorOptions`。（先 `grep -n "NavigationHandle" packages/front/src` 定位再导出点。）

- [ ] **Step 2：构建 + 全量验证**

Run: `vp run -r build`
Expected: 全包构建通过（front 的 tsdown noExternal 打包含新符号）。

Run: `vp test packages/browser packages/front`
Expected: PASS。

- [ ] **Step 3：提交**

```bash
git add packages/front/src/index.ts
git commit -m "feat(front): 再导出 island 编排器符号"
```

---

## Phase 2 完成定义（DoD）

- `createIslandOrchestrator` 落地：首次可见 mountEntry 一次、present-不可见 detach 保活、可见按序 attach、离树 unmount、dispose 全清。
- `fs:enter/reveal/conceal/exit` 按生命周期派发。
- conceal 捕获滚动、reveal rAF 重放。
- page 标识变化 → remount（支撑 refresh）。
- `startBrowserApp({ navigation: { mountEntry } })` 接通；缺省走原路径不破。
- `front` 再导出；`vp run -r build` + `vp test packages/browser packages/front` + `vp check packages/browser/src packages/browser/test` 全绿。

## 自审记录

- **spec 覆盖**：§4.0（两模型并存——mountEntry opt-in）、§4.1（islands + mountEntry 原语 + 编排器）、§4.2（detach 隐藏 + fs:\* + 滚动重放）、§4.4 协同（page 稳定/refresh remount）、§8 browser 段（navigation-islands + start-app + index）。§4.3 容器/chrome（outlet + app 画 chrome）落在 Task 5 接线 + Phase 5 模版。
- **占位扫描**：无 TBD；每步完整代码 + 精确 import/锚点。Task 1 split 用例直接构造 split 树字面量（避免依赖 `split` 构造器导出与否）。
- **类型一致**：`MountEntry`/`ResolvedEntry`/`IslandHandle`/`IslandOrchestrator`/`IslandOrchestratorOptions`、`MountedIsland`（内部）跨任务一致；`sync(snapshot: NavigationSnapshot)`、`schedule?: (cb) => void` 一致。
