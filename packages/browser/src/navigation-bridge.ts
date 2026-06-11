/**
 * NavigationBridge — 把 NavigationController 接到浏览器 History / URL
 *
 * Controller 自身对内容无关、不碰 history/URL（见 core）。这里负责把它「落地」到浏览器：
 *
 * - **快照 → history**：订阅 controller，快照变更时用 `serializeNavigation(tree)` 作为
 *   HistoryState 推入 LRU、用 `codec.encode(tree, router)` 作为地址栏 URL；首屏 / 同 URL
 *   用 `replaceState`，否则 `pushState`（对齐 FlowAction handler 的 first-page 语义）。
 * - **popstate → controller**：优先从 `History` 缓存的 State 读回整棵树
 *   （`deserializeNavigation`），缓存未命中（硬刷新 / 超过 LRU 容量的深层 entry）时回退
 *   `codec.decode(url, router)`；再调 `controller.hydrate(tree)` 重解析。
 * - **navigation handle**：向应用暴露 push/pop/popToRoot/replaceTop/selectTab/selectColumn
 *   + getSnapshot/subscribe，应用照常用自己的 UI 渲染。
 *
 * 关键不变量：popstate 触发的 `hydrate` 会回调订阅器，但**不可**再次写 history（否则
 * 制造冗余 entry / 循环）。用 `isApplyingHistory` 闸门把「来自 history 的提交」与「来自
 * 应用操作的提交」区分开 —— 只有后者写 history。
 *
 * `History` 的真实 State 存在内存 LRU（容量 10），window.history.state 只放 `{id}`。因此
 * 缓存未命中是常态（硬刷新 / 深层回退），codec.decode 回退是**必需**而非可选；codec 无法从
 * URL 同步还原时（默认 codec 对无 `__nav` 覆盖的 URL 返回 undefined），保留当前树不动。
 */

import type { Logger } from "@finesoft/core";
import {
    deserializeNavigation,
    serializeNavigation,
    type NavigationCodec,
    type NavigationController,
    type NavigationNode,
    type NavigationPath,
    type NavigationRouterLike,
    type NavigationSnapshot,
    type RouteParams,
    type SerializedNavigation,
} from "@finesoft/core";
import { History } from "./utils/history";

/** History 中缓存的导航 State：序列化后的整棵树（JSON-safe）。 */
interface NavigationHistoryState {
    tree: SerializedNavigation;
}

/** NavigationBridge 构造依赖。 */
export interface NavigationBridgeDependencies {
    /** 已构建好的导航控制器（持有 initial 树、intentDispatcher、router 等）。 */
    readonly controller: NavigationController;
    /** URL 编解码器（默认 `createActiveLeafCodec`）。 */
    readonly codec: NavigationCodec;
    /** Router 的最小读取面（encode 反查 / decode 用）。 */
    readonly router: NavigationRouterLike;
    /** 日志器。 */
    readonly log: Logger;
    /** 获取可滚动页面元素，用于滚动位置保存/恢复（透传给 History）。 */
    readonly getScrollablePageElement?: () => HTMLElement | null;
}

/**
 * 导航操作句柄 —— 向应用暴露的对外面。
 *
 * 所有写操作返回提交后的 `NavigationSnapshot`；写操作会同步把新树落到 history/URL。
 * `subscribe` 与 controller 的订阅一致（每次提交都回调，含来自 popstate 的 hydrate）。
 */
export interface NavigationHandle {
    /** 当前快照（树 + 已解析的可见目标）。 */
    getSnapshot(): NavigationSnapshot;
    /** 在激活栈压入新目标。 */
    push(
        intent: string,
        params?: RouteParams,
        options?: { target?: NavigationPath },
    ): Promise<NavigationSnapshot>;
    /** 从激活栈弹出 count 个（默认 1）。 */
    pop(count?: number): Promise<NavigationSnapshot>;
    /** 激活栈弹回根。 */
    popToRoot(): Promise<NavigationSnapshot>;
    /** 替换激活栈栈顶。 */
    replaceTop(intent: string, params?: RouteParams): Promise<NavigationSnapshot>;
    /** 切换 tabs 激活分支。 */
    selectTab(key: string, target?: NavigationPath): Promise<NavigationSnapshot>;
    /** 设置 split 列内容（intent=undefined 清空该列）。 */
    selectColumn(
        columnId: string,
        intent: string | undefined,
        params?: RouteParams,
        target?: NavigationPath,
    ): Promise<NavigationSnapshot>;
    /** 用外部树替换当前树并重解析（一般由桥内部 popstate 调用，亦对外暴露）。 */
    hydrate(tree: NavigationNode): Promise<NavigationSnapshot>;
    /** 订阅快照变更；返回取消订阅函数。 */
    subscribe(listener: (snapshot: NavigationSnapshot) => void): () => void;
}

/** 默认可滚动元素查找（与 FlowAction handler 一致）。 */
function defaultGetScrollable(): HTMLElement | null {
    return (
        document.getElementById("scrollable-page-override") ||
        document.getElementById("scrollable-page") ||
        document.documentElement
    );
}

/**
 * 创建 NavigationBridge：订阅 controller、装配 popstate、返回 navigation handle。
 *
 * 调用后 bridge 已激活（已订阅 controller + 已注册 popstate listener）。应用应在调用前/后
 * 调一次 `controller.resolve()` 完成首屏解析；首屏的快照提交会被 bridge 用 `replaceState`
 * 写入 history（first-page 语义），不会污染历史栈。
 */
export function createNavigationBridge(deps: NavigationBridgeDependencies): NavigationHandle {
    const { controller, codec, router, log } = deps;

    const history = new History<NavigationHistoryState>(log, {
        getScrollablePageElement: deps.getScrollablePageElement ?? defaultGetScrollable,
        // 导航树小且可结构化克隆：写进 window.history.state，使 back/forward 在整页刷新后仍能还原。
        persistInHistoryState: true,
    });

    // 闸门：来自 history（popstate）的提交不可回写 history。
    let isApplyingHistory = false;
    // first-page：首个快照用 replaceState（不新增历史栈条目）。
    let isFirstSnapshot = true;

    // ===== 快照 → history =====
    controller.subscribe((snapshot) => {
        if (isApplyingHistory) {
            // 该快照源于 popstate 的 hydrate：地址栏/历史栈已是目标状态，不再回写。
            return;
        }

        const url = codec.encode(snapshot.tree, router);
        const state: NavigationHistoryState = { tree: serializeNavigation(snapshot.tree) };

        const currentUrl =
            typeof window !== "undefined" ? window.location.pathname + window.location.search : url;
        const shouldReplace = isFirstSnapshot || url === currentUrl;

        history.beforeTransition();
        if (shouldReplace) {
            history.replaceState(state, url);
        } else {
            history.pushState(state, url);
        }
        isFirstSnapshot = false;
        log.debug(`[navigation] snapshot → ${shouldReplace ? "replace" : "push"} ${url}`);
    });

    // ===== popstate → controller =====
    history.onPopState(async (url, cachedState) => {
        log.debug(`[navigation] popstate → ${url}, cached=${!!cachedState}`);

        const tree = restoreTree(url, cachedState);
        if (tree === undefined) {
            // 缓存未命中且 codec 无法从 URL 同步还原 → 保留当前树不动（避免误清空）。
            log.warn(`[navigation] popstate: cannot restore tree for ${url}, keeping current`);
            return;
        }

        isApplyingHistory = true;
        try {
            await controller.hydrate(tree);
        } finally {
            isApplyingHistory = false;
        }
    });

    /** 还原整棵树：优先 history 缓存（反序列化），未命中回退 codec.decode。 */
    function restoreTree(
        url: string,
        cachedState: NavigationHistoryState | undefined,
    ): NavigationNode | undefined {
        if (cachedState !== undefined) {
            try {
                return deserializeNavigation(cachedState.tree);
            } catch (error) {
                // 缓存损坏（极少见）：降级到 codec.decode。
                log.warn(
                    "[navigation] cached tree deserialize failed, falling back to codec",
                    error,
                );
            }
        }
        try {
            return codec.decode(url, router);
        } catch (error) {
            log.error("[navigation] codec.decode failed:", error);
            return undefined;
        }
    }

    // ===== navigation handle =====
    return {
        getSnapshot() {
            return controller.getSnapshot();
        },
        push(intent, params, options) {
            return controller.push(intent, params, options);
        },
        pop(count) {
            return controller.pop(count);
        },
        popToRoot() {
            return controller.popToRoot();
        },
        replaceTop(intent, params) {
            return controller.replaceTop(intent, params);
        },
        selectTab(key, target) {
            return controller.selectTab(key, target);
        },
        selectColumn(columnId, intent, params, target) {
            return controller.selectColumn(columnId, intent, params, target);
        },
        hydrate(tree) {
            return controller.hydrate(tree);
        },
        subscribe(listener) {
            return controller.subscribe(listener);
        },
    };
}
