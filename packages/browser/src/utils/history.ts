/**
 * History 管理器 — 浏览器历史状态 + 滚动位置
 */

import type { Logger } from "@finesoft/core";
import { LruMap, generateUuid } from "@finesoft/core";
import { cancelTryScroll, tryScroll } from "./try-scroll";

const HISTORY_SIZE_LIMIT = 10;

interface HistoryEntry<State> {
    state: State;
    scrollY: number;
}

interface HistoryOptions {
    getScrollablePageElement: () => HTMLElement | null;
    /**
     * 是否把 `state` 一并写入 `window.history.state`（而非仅 `{ id }` + 内存 LruMap）。缺省 `false`。
     *
     * 内存 LruMap 在整页刷新后丢失；若 state 小且可结构化克隆（如导航树 `{ tree }`），开启此项
     * 可让 state 随 `window.history.state` **跨刷新按 entry 保留**，刷新后 back/forward 仍能从
     * history.state 还原（onPopState 在 LruMap 未命中时回退到 `event.state.state`）。
     * 大状态（如整页 `{ page }`）不应开启，避免撑爆 history.state。
     */
    persistInHistoryState?: boolean;
}

export class History<State> {
    private readonly entries: LruMap<string, HistoryEntry<State>>;
    private readonly log: Logger;
    private readonly getScrollablePageElement: () => HTMLElement | null;
    private readonly persistInHistoryState: boolean;
    private currentStateId: string | undefined;
    private popstateSequence = 0;

    constructor(log: Logger, options: HistoryOptions, sizeLimit = HISTORY_SIZE_LIMIT) {
        this.entries = new LruMap(sizeLimit);
        this.log = log;
        this.getScrollablePageElement = options.getScrollablePageElement;
        this.persistInHistoryState = options.persistInHistoryState ?? false;
    }

    /** 写入 window.history.state 的载荷：persist 时连 state 一起带（跨刷新保留）。 */
    private historyState(id: string, state: State): { id: string; state?: State } {
        return this.persistInHistoryState ? { id, state } : { id };
    }

    replaceState(state: State, url: string): void {
        cancelTryScroll();
        const id = generateUuid();
        window.history.replaceState(this.historyState(id, state), "", url);
        this.currentStateId = id;
        this.entries.set(id, { state, scrollY: 0 });
        this.scrollTop = 0;
        this.log.info("replaceState", state, url, id);
    }

    pushState(state: State, url: string): void {
        cancelTryScroll();
        const id = generateUuid();
        window.history.pushState(this.historyState(id, state), "", url);
        this.currentStateId = id;
        this.entries.set(id, { state, scrollY: 0 });
        this.scrollTop = 0;
        this.log.info("pushState", state, url, id);
    }

    beforeTransition(): void {
        cancelTryScroll();
        const { state } = window.history;
        if (!state) return;

        this.saveScrollPosition(state.id);
    }

    private saveScrollPosition(stateId: string | undefined): void {
        if (!stateId) return;

        const oldEntry = this.entries.get(stateId);
        if (!oldEntry) {
            this.log.info("current history state evicted from LRU, not saving scroll position");
            return;
        }

        const { scrollTop } = this;
        this.entries.set(stateId, { ...oldEntry, scrollY: scrollTop });
        this.log.info("saving scroll position", scrollTop);
    }

    onPopState(listener: (url: string, state?: State) => void | Promise<void>): void {
        window.addEventListener("popstate", (event: PopStateEvent) => {
            cancelTryScroll();
            this.saveScrollPosition(this.currentStateId);

            const targetStateId = event.state?.id;
            const sequence = ++this.popstateSequence;
            this.currentStateId = targetStateId;

            if (!this.currentStateId) {
                this.log.warn(
                    "encountered a null event.state.id in onPopState event:",
                    window.location.href,
                );
            }

            this.log.info("popstate", this.entries, this.currentStateId);

            const entry = this.currentStateId ? this.entries.get(this.currentStateId) : undefined;
            // LruMap 未命中（如整页刷新后）时，回退到嵌入 window.history.state 的 state（persist 模式）。
            const embedded = this.persistInHistoryState
                ? (event.state as { state?: State } | null)?.state
                : undefined;
            const cachedState = entry?.state ?? embedded;

            let navigation: void | Promise<void>;
            try {
                navigation = listener(window.location.href, cachedState);
            } catch (error: unknown) {
                this.log.error("onPopState listener error:", error);
                return;
            }

            void Promise.resolve(navigation).then(
                () => {
                    if (
                        sequence !== this.popstateSequence ||
                        this.currentStateId !== targetStateId ||
                        !entry
                    ) {
                        return;
                    }

                    const { scrollY } = entry;
                    this.log.info("restoring scroll to", scrollY);
                    tryScroll(this.log, () => this.getScrollablePageElement(), scrollY);
                },
                (error: unknown) => {
                    this.log.error("onPopState listener error:", error);
                },
            );
        });
    }

    /** 仅推入 URL，不缓存页面状态（用于页面加载失败场景） */
    pushUrl(url: string): void {
        cancelTryScroll();
        const id = generateUuid();
        window.history.pushState({ id }, "", url);
        this.currentStateId = id;
        this.scrollTop = 0;
        this.log.info("pushUrl (no state)", url, id);
    }

    /** 仅替换 URL，不缓存页面状态（用于页面加载失败场景） */
    replaceUrl(url: string): void {
        cancelTryScroll();
        const id = generateUuid();
        window.history.replaceState({ id }, "", url);
        this.currentStateId = id;
        this.scrollTop = 0;
        this.log.info("replaceUrl (no state)", url, id);
    }

    updateState(update: (current?: State) => State): void {
        if (!this.currentStateId) {
            this.log.warn("failed: encountered a null currentStateId inside updateState");
            return;
        }

        const currentState = this.entries.get(this.currentStateId);
        const newState = update(currentState?.state);
        this.log.info("updateState", newState, this.currentStateId);
        // currentState 可能为 undefined（条目被 LRU 驱逐或由 pushUrl/replaceUrl 创建）
        // 必须保证 scrollY 字段存在
        this.entries.set(this.currentStateId, {
            scrollY: currentState?.scrollY ?? 0,
            state: newState,
        });
    }

    private get scrollTop(): number {
        return this.getScrollablePageElement()?.scrollTop || 0;
    }

    private set scrollTop(scrollTop: number) {
        const element = this.getScrollablePageElement();
        if (element) {
            element.scrollTop = scrollTop;
        }
    }
}
