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
}

export class History<State> {
    private readonly entries: LruMap<string, HistoryEntry<State>>;
    private readonly log: Logger;
    private readonly getScrollablePageElement: () => HTMLElement | null;
    private currentStateId: string | undefined;

    constructor(log: Logger, options: HistoryOptions, sizeLimit = HISTORY_SIZE_LIMIT) {
        this.entries = new LruMap(sizeLimit);
        this.log = log;
        this.getScrollablePageElement = options.getScrollablePageElement;
    }

    replaceState(state: State, url: string): void {
        cancelTryScroll();
        const id = generateUuid();
        window.history.replaceState({ id }, "", url);
        this.currentStateId = id;
        this.entries.set(id, { state, scrollY: 0 });
        this.scrollTop = 0;
        this.log.info("replaceState", state, url, id);
    }

    pushState(state: State, url: string): void {
        cancelTryScroll();
        const id = generateUuid();
        window.history.pushState({ id }, "", url);
        this.currentStateId = id;
        this.entries.set(id, { state, scrollY: 0 });
        this.scrollTop = 0;
        this.log.info("pushState", state, url, id);
    }

    beforeTransition(): void {
        cancelTryScroll();
        const { state } = window.history;
        if (!state) return;

        const oldEntry = this.entries.get(state.id);
        if (!oldEntry) {
            this.log.info("current history state evicted from LRU, not saving scroll position");
            return;
        }

        const { scrollTop } = this;
        this.entries.set(state.id, { ...oldEntry, scrollY: scrollTop });
        this.log.info("saving scroll position", scrollTop);
    }

    onPopState(listener: (url: string, state?: State) => void | Promise<void>): void {
        window.addEventListener("popstate", (event: PopStateEvent) => {
            cancelTryScroll();
            this.currentStateId = event.state?.id;

            if (!this.currentStateId) {
                this.log.warn(
                    "encountered a null event.state.id in onPopState event:",
                    window.location.href,
                );
            }

            this.log.info("popstate", this.entries, this.currentStateId);

            const entry = this.currentStateId ? this.entries.get(this.currentStateId) : undefined;

            void Promise.resolve(listener(window.location.href, entry?.state)).catch(
                (error: unknown) => {
                    this.log.error("onPopState listener error:", error);
                },
            );

            if (!entry) {
                return;
            }

            const { scrollY } = entry;
            this.log.info("restoring scroll to", scrollY);
            tryScroll(this.log, () => this.getScrollablePageElement(), scrollY);
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
        this.entries.set(this.currentStateId, {
            ...(currentState as HistoryEntry<State>),
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
