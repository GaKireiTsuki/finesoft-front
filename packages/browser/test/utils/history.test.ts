import type { Logger } from "@finesoft/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

const { cancelTryScroll, generateUuid, tryScroll } = vi.hoisted(() => ({
    generateUuid: vi.fn(),
    tryScroll: vi.fn(),
    cancelTryScroll: vi.fn(),
}));

vi.mock("@finesoft/core", async () => {
    const actual = await import("../../../core/src/index.ts");
    return {
        ...actual,
        generateUuid,
    };
});

vi.mock("../../src/utils/try-scroll", () => ({
    tryScroll,
    cancelTryScroll,
}));

import { History } from "../../src/utils/history";

type HistoryState = { page: string };

type PopStateListener = (event: PopStateEvent) => void;

interface ScrollableElementLike {
    scrollTop: number;
}

let listeners: Map<string, PopStateListener>;
let locationState: {
    href: string;
    origin: string;
    pathname: string;
    search: string;
};
let historyState: { id?: string } | null;
let scrollableElement: ScrollableElementLike;

beforeEach(() => {
    listeners = new Map();
    historyState = null;
    scrollableElement = { scrollTop: 0 };
    locationState = {
        href: "https://example.com/",
        origin: "https://example.com",
        pathname: "/",
        search: "",
    };

    generateUuid.mockReset();
    tryScroll.mockReset();
    cancelTryScroll.mockReset();

    vi.stubGlobal("window", {
        history: {
            get state() {
                return historyState;
            },
            set state(nextState: { id?: string } | null) {
                historyState = nextState;
            },
            pushState: vi.fn((state: { id?: string }, _title: string, url: string) => {
                historyState = state;
                applyUrl(url);
            }),
            replaceState: vi.fn((state: { id?: string }, _title: string, url: string) => {
                historyState = state;
                applyUrl(url);
            }),
        },
        location: locationState,
        addEventListener: vi.fn((type: string, listener: PopStateListener) => {
            listeners.set(type, listener);
        }),
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("History", () => {
    test("returns early when beforeTransition has no active browser history state", () => {
        const log = makeLogger();
        const history = createHistory(log);

        history.beforeTransition();

        expect(cancelTryScroll).toHaveBeenCalledTimes(1);
        expect(log.info).not.toHaveBeenCalledWith("saving scroll position", expect.anything());
    });

    test("replaces state, saves scroll position, and restores it on popstate", async () => {
        generateUuid.mockReturnValueOnce("id-1");

        const log = makeLogger();
        const history = createHistory(log);
        const listener = vi.fn();
        const historyApi = window.history as unknown as {
            replaceState: ReturnType<typeof vi.fn>;
        };
        history.onPopState(listener);

        history.replaceState({ page: "home" }, "/home");
        scrollableElement.scrollTop = 96;
        history.beforeTransition();

        triggerPopState({ id: "id-1" }, "https://example.com/home");
        await flushMicrotasks();

        expect(historyApi.replaceState).toHaveBeenCalledWith({ id: "id-1" }, "", "/home");
        expect(cancelTryScroll).toHaveBeenCalled();
        expect(listener).toHaveBeenCalledWith("https://example.com/home", {
            page: "home",
        });
        expect(tryScroll).toHaveBeenCalledWith(log, expect.any(Function), 96);
        expect(log.info).toHaveBeenCalledWith("saving scroll position", 96);
    });

    test("waits for popstate navigation to finish before restoring scroll", async () => {
        generateUuid.mockReturnValueOnce("id-1");

        const log = makeLogger();
        const history = createHistory(log);
        let finishNavigation: (() => void) | undefined;
        const navigationFinished = new Promise<void>((resolve) => {
            finishNavigation = resolve;
        });

        history.onPopState(() => navigationFinished);
        history.replaceState({ page: "home" }, "/home");
        scrollableElement.scrollTop = 96;
        history.beforeTransition();

        triggerPopState({ id: "id-1" }, "https://example.com/home");

        expect(tryScroll).not.toHaveBeenCalled();

        finishNavigation?.();
        await flushMicrotasks();

        expect(tryScroll).toHaveBeenCalledWith(log, expect.any(Function), 96);
    });

    test("saves the outgoing entry scroll before popstate so forward can restore it", async () => {
        generateUuid.mockReturnValueOnce("id-home").mockReturnValueOnce("id-detail");

        const log = makeLogger();
        const history = createHistory(log);
        history.onPopState(() => undefined);
        history.replaceState({ page: "home" }, "/home");
        history.pushState({ page: "detail" }, "/detail");

        scrollableElement.scrollTop = 184;
        triggerPopState({ id: "id-home" }, "https://example.com/home");
        await flushMicrotasks();

        tryScroll.mockClear();
        scrollableElement.scrollTop = 32;
        triggerPopState({ id: "id-detail" }, "https://example.com/detail");
        await flushMicrotasks();

        expect(tryScroll).toHaveBeenCalledWith(log, expect.any(Function), 184);
    });

    test("falls back to zero scroll positions when no scrollable element is available", async () => {
        generateUuid.mockReturnValueOnce("id-1");

        const log = makeLogger();
        const history = new History<HistoryState>(
            log,
            {
                getScrollablePageElement: () => null,
            },
            10,
        );
        const listener = vi.fn();

        history.onPopState(listener);
        history.replaceState({ page: "home" }, "/home");
        history.beforeTransition();

        triggerPopState({ id: "id-1" }, "https://example.com/home");
        await flushMicrotasks();

        expect(listener).toHaveBeenCalledWith("https://example.com/home", {
            page: "home",
        });
        expect(tryScroll).toHaveBeenCalledWith(log, expect.any(Function), 0);
        expect(log.info).toHaveBeenCalledWith("saving scroll position", 0);
    });

    test("logs when the previous history state was evicted from the LRU cache", () => {
        generateUuid.mockReturnValueOnce("id-1");
        generateUuid.mockReturnValueOnce("id-2");

        const log = makeLogger();
        const history = createHistory(log, 1);

        history.replaceState({ page: "first" }, "/first");
        history.pushState({ page: "second" }, "/second");
        historyState = { id: "id-1" };

        history.beforeTransition();

        expect(log.info).toHaveBeenCalledWith(
            "current history state evicted from LRU, not saving scroll position",
        );
    });

    test("warns on popstate events without an id and reports listener failures", async () => {
        const log = makeLogger();
        const history = createHistory(log);
        const listener = vi.fn(async () => {
            throw new Error("boom");
        });

        history.onPopState(listener);
        triggerPopState(null, "https://example.com/missing");
        await flushMicrotasks();

        expect(log.warn).toHaveBeenCalledWith(
            "encountered a null event.state.id in onPopState event:",
            "https://example.com/missing",
        );
        expect(log.error).toHaveBeenCalledWith("onPopState listener error:", expect.any(Error));
        expect(tryScroll).not.toHaveBeenCalled();
    });

    test("pushUrl and replaceUrl update the address bar without caching page data", async () => {
        generateUuid.mockReturnValueOnce("id-1");
        generateUuid.mockReturnValueOnce("id-2");

        const log = makeLogger();
        const history = createHistory(log);
        const listener = vi.fn();
        const historyApi = window.history as unknown as {
            pushState: ReturnType<typeof vi.fn>;
            replaceState: ReturnType<typeof vi.fn>;
        };
        history.onPopState(listener);

        history.pushUrl("/plain");
        triggerPopState({ id: "id-1" }, "https://example.com/plain");
        await flushMicrotasks();

        history.replaceUrl("/plain?updated=1");

        expect(historyApi.pushState).toHaveBeenCalledWith({ id: "id-1" }, "", "/plain");
        expect(historyApi.replaceState).toHaveBeenCalledWith(
            { id: "id-2" },
            "",
            "/plain?updated=1",
        );
        expect(listener).toHaveBeenCalledWith("https://example.com/plain", undefined);
        expect(tryScroll).not.toHaveBeenCalled();
    });

    test("updates cached state and warns when updateState is called too early", async () => {
        generateUuid.mockReturnValueOnce("id-1");

        const log = makeLogger();
        const history = createHistory(log);
        const listener = vi.fn();

        history.updateState(() => ({ page: "ignored" }));
        history.onPopState(listener);
        history.replaceState({ page: "home" }, "/home");
        history.updateState((current) => ({
            page: `${current?.page ?? "none"}-updated`,
        }));

        triggerPopState({ id: "id-1" }, "https://example.com/home");
        await flushMicrotasks();

        expect(log.warn).toHaveBeenCalledWith(
            "failed: encountered a null currentStateId inside updateState",
        );
        expect(listener).toHaveBeenCalledWith("https://example.com/home", {
            page: "home-updated",
        });
    });

    test("persistInHistoryState embeds state in window.history.state for reload survival", () => {
        const log = makeLogger();
        generateUuid.mockReturnValue("nav-1");
        const history = new History<HistoryState>(log, {
            getScrollablePageElement: () => scrollableElement as HTMLElement,
            persistInHistoryState: true,
        });
        history.pushState({ page: "detail" }, "/item/2");
        // state 随 window.history.state 一并写入（而非仅 {id}）→ 整页刷新后仍保留。
        expect(historyState).toEqual({ id: "nav-1", state: { page: "detail" } });
    });

    test("persistInHistoryState recovers state from event.state on popstate after a reload (empty LRU)", () => {
        const log = makeLogger();
        // 模拟整页刷新后的全新实例：LRU 为空。
        const fresh = new History<HistoryState>(log, {
            getScrollablePageElement: () => scrollableElement as HTMLElement,
            persistInHistoryState: true,
        });
        const received: Array<HistoryState | undefined> = [];
        fresh.onPopState((_url, state) => {
            received.push(state);
        });
        // popstate 的 event.state 带刷新前嵌入的 state；LRU 未命中 → 回退到它。
        triggerPopState(
            { id: "before-reload", state: { page: "home" } } as never,
            "https://example.com/",
        );
        expect(received).toEqual([{ page: "home" }]);
    });

    test("default (no persist) keeps window.history.state as {id} only", () => {
        const log = makeLogger();
        generateUuid.mockReturnValue("flat-1");
        const history = createHistory(log);
        history.pushState({ page: "big" }, "/x");
        expect(historyState).toEqual({ id: "flat-1" });
    });
});

function createHistory(log: Logger, sizeLimit?: number): History<HistoryState> {
    return new History<HistoryState>(
        log,
        {
            getScrollablePageElement: () => scrollableElement as HTMLElement,
        },
        sizeLimit,
    );
}

function makeLogger(): Logger & {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
} {
    return {
        debug: vi.fn(() => ""),
        info: vi.fn(() => ""),
        warn: vi.fn(() => ""),
        error: vi.fn(() => ""),
    };
}

function triggerPopState(state: { id?: string } | null, href: string): void {
    applyUrl(href);
    const listener = listeners.get("popstate");
    if (!listener) {
        throw new Error("popstate listener was not registered");
    }

    listener({ state } as PopStateEvent);
}

function applyUrl(url: string): void {
    const parsed = new URL(url, locationState.origin);
    locationState.href = parsed.href;
    locationState.pathname = parsed.pathname;
    locationState.search = parsed.search;
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}
