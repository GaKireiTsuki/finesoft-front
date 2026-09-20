/**
 * SessionBridge — 把 SessionStore 接到浏览器生命周期（自动捕获 + boot 恢复 + scoped prune）
 *
 * SessionStore（Web）本身对浏览器无关：它只懂 capture / persist / load / restore，不订阅导航、
 * 不碰 `window`。本文件负责把它「落地」到浏览器运行时：
 *
 * - **自动捕获**：导航变更（`subscribeNavigation`）时**先** `store.scope.prune(navigation.presentKeys())`
 *   —— 这正是「pop B 后 B 的作用域状态消失」的落点（离树条目被丢弃，对标 SwiftUI `@State`
 *   push/pop 生命周期）—— 再防抖落盘（默认 `SESSION_DEFAULT_DEBOUNCE_MS`，合并连续导航）。
 * - **生命周期落盘**：`window` 的 `pagehide` 与 `document` 的 `visibilitychange`
 *   （仅 `visibilityState === "hidden"`）请求异步保存；浏览器关闭不保证其完成。
 * - **boot 恢复**：`restoreFromUrl(currentUrl)` 读快照，命中且通过 `shouldRestore` 门控才整体应用
 *   （nav + slices 一个布尔门）。默认策略 `defaultShouldRestore` 遵循「显式深链优先」。
 * - **dispose**：反订阅、解绑、提交挂起保存，等已登记存储工作完成。
 *
 * 不配 session 的应用不构造 bridge；产物体积以实际构建测量为准。
 */

import type {
    SessionNavigation,
    SessionRestoreResult,
    SessionSnapshot,
    SessionStore,
} from "@finesoft/web";

/** 导航变更后自动落盘的默认防抖窗口（ms）：合并连续导航，避免每跳一屏写一次。 */
export const SESSION_DEFAULT_DEBOUNCE_MS = 500;

/** `createSessionBridge` 选项。 */
export interface SessionBridgeOptions {
    /** Standard starters pause automatic saves until hydration and persisted restore finish. */
    readonly deferPersistenceUntilRestore?: boolean;
    /** 会话编排器（Web）。 */
    readonly store: SessionStore;
    /** 导航端口；导航变更时用其 `presentKeys()` 驱动 scoped prune。 */
    readonly navigation: SessionNavigation;
    /** 订阅导航变更；返回反订阅函数。省略 = 不自动捕获（仅靠生命周期事件 + 手动 `save`）。 */
    readonly subscribeNavigation?: (onChange: () => void) => () => void;
    /** 自动落盘防抖窗口（ms）；默认 `SESSION_DEFAULT_DEBOUNCE_MS`。 */
    readonly debounceMs?: number;
    /** 恢复门控；默认 `defaultShouldRestore`（显式深链优先，见其文档）。 */
    readonly shouldRestore?: (snapshot: SessionSnapshot, currentUrl: string) => boolean;
}

/** The store itself owns state and persistence; the browser adds lifecycle restoration. */
export interface BrowserSession extends SessionStore {
    restoreFromUrl(currentUrl: string): Promise<SessionRestoreResult>;
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
 * - **带可比 URL**（快照含 `url` —— 扁平天然有，结构化由适配器在 capture 时记录浏览器
 *   `location`）：当且仅当 `currentUrl` 全等 `snapshot.url`，**或** `currentUrl` 路径为根 `/`
 *   （重载同深链 / 全新进入 → 恢复；改去别的深链 → 跳过，显式深链不被旧会话覆盖）。
 *   这让结构化导航与扁平**对称**：重载 `/item/1` 即恢复其作用域状态。
 * - **回退（无 `url`）**：适配器不提供 URL 时只在根 `/` 放行。
 * - **无 `navigation`**（仅切片）：总恢复（与 URL 无关）。
 *
 * 「根」判定为路径 `=== "/"`（剥离 query/hash）；带 base path 的应用应覆盖 `shouldRestore`。
 */
export function defaultShouldRestore(snapshot: SessionSnapshot, currentUrl: string): boolean {
    const nav = snapshot.navigation;
    if (nav === undefined) return true;
    const atRoot = pathOf(currentUrl) === "/";
    // 可比 URL 优先（capture 时刻的真实位置）：扁平/结构化经此走对称逻辑。
    if (snapshot.url !== undefined) return currentUrl === snapshot.url || atRoot;
    return atRoot;
}

/**
 * 创建 SessionBridge：订阅导航、装配生命周期监听、返回会话句柄。
 *
 * 调用后 bridge 已激活（已订阅导航 + 已注册 `pagehide` / `visibilitychange`）。应用应在
 * 首次导航完成后调一次 `restoreFromUrl(initialUrl)` 完成 boot 恢复。
 */
export function createSessionBridge(options: SessionBridgeOptions): BrowserSession {
    const { store, navigation, subscribeNavigation } = options;
    const clear = store.clear.bind(store),
        dispose = store.dispose.bind(store);
    const debounceMs = options.debounceMs ?? SESSION_DEFAULT_DEBOUNCE_MS;
    const shouldRestore = options.shouldRestore ?? defaultShouldRestore;

    let disposed: Promise<void> | undefined;
    let restoring = options.deferPersistenceUntilRestore ?? false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function cancelTimer(): void {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
    }

    /** 立即落盘并取消挂起的防抖（生命周期事件用）。 */
    function flush(): void {
        if (disposed || restoring) return;
        cancelTimer();
        void store.save();
    }

    /** 导航变更：先 prune 离树作用域，再防抖落盘。 */
    function onNavigationChange(): void {
        if (disposed || restoring) return;
        store.scope.prune(navigation.presentKeys());
        cancelTimer();
        timer = setTimeout(() => {
            timer = undefined;
            void store.save();
        }, debounceMs);
    }

    /** `visibilitychange`：仅在隐藏时落盘（切后台 / 回收前抓末态）。 */
    function onVisibilityChange(): void {
        if (document.visibilityState === "hidden") flush();
    }

    const unsubscribeNavigation = subscribeNavigation?.(onNavigationChange);

    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return Object.assign(store, {
        async restoreFromUrl(currentUrl: string): Promise<SessionRestoreResult> {
            if (disposed) return { status: "closed" };
            restoring = true;
            cancelTimer();
            try {
                const loaded = await store.load();
                if (disposed) return { status: "closed" };
                if (loaded.status !== "loaded") return loaded;
                if (!shouldRestore(loaded.snapshot, currentUrl)) return { status: "skipped" };
                return await store.restore(loaded.snapshot);
            } finally {
                restoring = false;
            }
        },
        clear() {
            cancelTimer();
            return clear();
        },
        dispose(): Promise<void> {
            if (disposed) return disposed;
            // Queue one final current-state capture before closing; store.dispose waits for it.
            if (!restoring) flush();
            cancelTimer();
            unsubscribeNavigation?.();
            window.removeEventListener("pagehide", flush);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            disposed = dispose();
            return disposed;
        },
    });
}
