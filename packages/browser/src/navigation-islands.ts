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
