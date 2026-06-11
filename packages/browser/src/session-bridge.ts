/**
 * SessionBridge — 把 SessionStore 接到浏览器生命周期（自动捕获 + boot 恢复 + scoped prune）
 *
 * SessionStore（core）本身对浏览器无关：它只懂 capture / persist / load / restore，不订阅导航、
 * 不碰 `window`。本文件负责把它「落地」到浏览器运行时：
 *
 * - **自动捕获**：导航变更（`subscribeNavigation`）时**先** `store.scope.prune(adapter.presentKeys())`
 *   —— 这正是「pop B 后 B 的作用域状态消失」的落点（离树条目被丢弃，对标 SwiftUI `@State`
 *   push/pop 生命周期）—— 再防抖落盘（默认 `SESSION_DEFAULT_DEBOUNCE_MS`，合并连续导航）。
 * - **生命周期落盘**：`window` 的 `pagehide` 与 `document` 的 `visibilitychange`
 *   （仅 `visibilityState === "hidden"`）立即落盘并取消挂起的防抖 —— 比 `beforeunload`
 *   在移动端更可靠（标签切到后台 / 被系统回收前能抓到末态）。
 * - **boot 恢复**：`restore(currentUrl)` 读快照，命中且通过 `shouldRestore` 门控才整体应用
 *   （nav + slices 一个布尔门）。默认策略 `defaultShouldRestore` 遵循「显式深链优先」。
 * - **dispose**：反订阅导航 + 解绑全部监听 + 清挂起定时器，幂等无残留。
 *
 * 纯附加：不配 session 的应用永远不会构造 bridge，原有启动路径字节级不变。
 */

import { isUrlLocation } from "@finesoft/core";
import type { SessionNavigationAdapter, SessionSnapshot, SessionStore } from "@finesoft/core";

/** 导航变更后自动落盘的默认防抖窗口（ms）：合并连续导航，避免每跳一屏写一次。 */
export const SESSION_DEFAULT_DEBOUNCE_MS = 500;

/** `createSessionBridge` 选项。 */
export interface SessionBridgeOptions {
    /** 会话编排器（core）。 */
    readonly store: SessionStore;
    /** 导航适配器；导航变更时用其 `presentKeys()` 驱动 scoped prune。 */
    readonly adapter: SessionNavigationAdapter;
    /** 订阅导航变更；返回反订阅函数。省略 = 不自动捕获（仅靠生命周期事件 + 手动 `save`）。 */
    readonly subscribeNavigation?: (onChange: () => void) => () => void;
    /** 自动落盘防抖窗口（ms）；默认 `SESSION_DEFAULT_DEBOUNCE_MS`。 */
    readonly debounceMs?: number;
    /** 恢复门控；默认 `defaultShouldRestore`（显式深链优先，见其文档）。 */
    readonly shouldRestore?: (snapshot: SessionSnapshot, currentUrl: string) => boolean;
}

/** SessionBridge 对外句柄：boot 恢复 + 手动逃生口 + 解绑。 */
export interface SessionHandle {
    /** boot 时调用：读快照，通过门控则整体恢复（nav + slices）。 */
    restore(currentUrl: string): void | Promise<void>;
    /** 手动落盘（= `store.save()`）。 */
    save(): void;
    /** 清除持久化快照（= `store.clear()`）。 */
    clear(): void;
    /** 反订阅导航 + 解绑全部监听 + 清挂起定时器（幂等）。 */
    dispose(): void;
}

/** 剥离 query / hash，仅取路径部分（用于「根入口」判定）。 */
function pathOf(url: string): string {
    const queryAt = url.indexOf("?");
    const hashAt = url.indexOf("#");
    const cut = [queryAt, hashAt].filter((i) => i >= 0);
    return cut.length > 0 ? url.slice(0, Math.min(...cut)) : url;
}

/**
 * 默认恢复门控策略（精确、无歧义，遵循「显式深链优先」）。
 *
 * - **扁平**（`navigation` 为 `SessionUrlLocation`）：当且仅当 `currentUrl` 全等快照 URL，
 *   **或** `currentUrl` 路径为根 `/`（重载同页 / 全新进入 → 恢复；不同深链 → 跳过，
 *   显式深链不被旧会话覆盖）。
 * - **结构化**（`navigation` 为 `SerializedNavigation`）：当且仅当 `currentUrl` 路径为根 `/`
 *   （树无单一可比 URL，门设在「入口」；要更细由应用覆盖 predicate）。
 * - **无 `navigation`**（仅切片）：总恢复（与 URL 无关）。
 *
 * 「根」判定为路径 `=== "/"`（剥离 query/hash）；带 base path 的应用应覆盖 `shouldRestore`。
 */
export function defaultShouldRestore(snapshot: SessionSnapshot, currentUrl: string): boolean {
    const nav = snapshot.navigation;
    if (nav === undefined) return true;
    const atRoot = pathOf(currentUrl) === "/";
    if (isUrlLocation(nav)) return currentUrl === nav.url || atRoot;
    return atRoot;
}

/**
 * 创建 SessionBridge：订阅导航、装配生命周期监听、返回会话句柄。
 *
 * 调用后 bridge 已激活（已订阅导航 + 已注册 `pagehide` / `visibilitychange`）。应用应在
 * 首次导航完成后调一次 `restore(initialUrl)` 完成 boot 恢复。
 */
export function createSessionBridge(options: SessionBridgeOptions): SessionHandle {
    const { store, adapter, subscribeNavigation } = options;
    const debounceMs = options.debounceMs ?? SESSION_DEFAULT_DEBOUNCE_MS;
    const shouldRestore = options.shouldRestore ?? defaultShouldRestore;

    let timer: ReturnType<typeof setTimeout> | undefined;

    function cancelTimer(): void {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
    }

    /** 立即落盘并取消挂起的防抖（生命周期事件用）。 */
    function flush(): void {
        cancelTimer();
        store.save();
    }

    /** 导航变更：先 prune 离树作用域，再防抖落盘。 */
    function onNavigationChange(): void {
        store.scope.prune(adapter.presentKeys());
        cancelTimer();
        timer = setTimeout(() => {
            timer = undefined;
            store.save();
        }, debounceMs);
    }

    /** `visibilitychange`：仅在隐藏时落盘（切后台 / 回收前抓末态）。 */
    function onVisibilityChange(): void {
        if (document.visibilityState === "hidden") flush();
    }

    const unsubscribeNavigation = subscribeNavigation?.(onNavigationChange);

    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return {
        restore(currentUrl: string): void | Promise<void> {
            const snapshot = store.load();
            if (snapshot !== undefined && shouldRestore(snapshot, currentUrl)) {
                return store.restore(snapshot);
            }
            return undefined;
        },
        save(): void {
            store.save();
        },
        clear(): void {
            store.clear();
        },
        dispose(): void {
            cancelTimer();
            unsubscribeNavigation?.();
            window.removeEventListener("pagehide", flush);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        },
    };
}
