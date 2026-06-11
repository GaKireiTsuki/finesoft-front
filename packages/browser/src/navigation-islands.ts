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
    /** 重放调度（默认 requestAnimationFrame；测试可注入同步执行）。 */
    readonly schedule?: (cb: () => void) => void;
}

/** 编排器对外接口。 */
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
    /** fs:enter 是否已派发（挂载时置 false，首次 attach 后置 true）。 */
    entered: boolean;
    /** conceal 时记录的滚动位置（按可滚动元素序）。 */
    scroll?: { top: number; left: number }[];
}

/** 在 container 上派发生命周期 CustomEvent（bubbles: true，会冒泡到 outlet）。 */
function emit(
    container: HTMLElement,
    type: "fs:enter" | "fs:reveal" | "fs:conceal" | "fs:exit",
): void {
    container.dispatchEvent(new CustomEvent(type, { bubbles: true }));
}

export function createIslandOrchestrator(options: IslandOrchestratorOptions): IslandOrchestrator {
    const { outlet, mountEntry } = options;
    const mounted = new Map<string, MountedIsland>();

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

    function conceal(island: MountedIsland): void {
        if (!island.attached) return;
        captureScroll(island);
        emit(island.container, "fs:conceal");
        island.container.remove(); // 出 document（保活，实例不销毁）
        island.attached = false;
    }

    function teardown(key: string, island: MountedIsland): void {
        // Emit fs:exit unconditionally (before remove if attached, or on the orphaned container if
        // already detached). Attached path bubbles to outlet-level listeners; detached path fires
        // only on the container itself. Semantics: fs:exit = "being destroyed", distinct from
        // fs:conceal = "going to background, staying alive".
        emit(island.container, "fs:exit");
        if (island.attached) {
            island.container.remove();
            island.attached = false;
        }
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
                mounted.set(key, { container, handle, attached: false, entered: false });
            }
        }

        // 3) detach 掉 present-但-不可见的 island（保活）。
        const visibleSet = new Set(visibleKeys);
        for (const [key, island] of mounted) {
            if (!visibleSet.has(key)) conceal(island);
        }

        // 4) 按 destinations 顺序 attach/reorder 可见 island（appendChild 已在则移动 → 重排）。
        //    派发顺序：首次 attach 前先 fs:enter（entered=false），再 fs:reveal；已有的只 fs:reveal。
        for (const key of visibleKeys) {
            const island = mounted.get(key);
            if (island === undefined) continue;
            const wasAttached = island.attached;
            outlet.appendChild(island.container);
            island.attached = true;
            if (!island.entered) {
                island.entered = true;
                emit(island.container, "fs:enter");
            }
            if (!wasAttached) {
                emit(island.container, "fs:reveal");
                restoreScroll(island);
            }
        }
    }

    function dispose(): void {
        for (const [key, island] of mounted) teardown(key, island);
    }

    return { sync, dispose };
}
