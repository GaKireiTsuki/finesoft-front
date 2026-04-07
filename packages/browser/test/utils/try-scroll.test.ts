import type { Logger } from "@finesoft/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { cancelTryScroll, tryScroll } from "../../src/utils/try-scroll";

interface ScrollableElementLike {
    clientHeight: number;
    scrollHeight: number;
    scrollTop: number;
}

type FrameCallback = (timestamp: number) => void;

let frameId = 0;
let pendingFrames: Array<{ id: number; callback: FrameCallback }> = [];

class MutationObserverMock {
    static instances: MutationObserverMock[] = [];

    private readonly callback: () => void;

    readonly disconnect = vi.fn();
    readonly observe = vi.fn();

    constructor(callback: () => void) {
        this.callback = callback;
        MutationObserverMock.instances.push(this);
    }

    static reset(): void {
        MutationObserverMock.instances = [];
    }

    static triggerAll(): void {
        for (const observer of MutationObserverMock.instances) {
            observer.callback();
        }
    }
}

describe("tryScroll", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-18T00:00:00.000Z"));

        frameId = 0;
        pendingFrames = [];
        MutationObserverMock.reset();

        vi.stubGlobal(
            "requestAnimationFrame",
            vi.fn((callback: FrameCallback) => {
                const id = ++frameId;
                pendingFrames.push({ id, callback });
                return id;
            }),
        );
        vi.stubGlobal(
            "cancelAnimationFrame",
            vi.fn((id: number) => {
                pendingFrames = pendingFrames.filter((frame) => frame.id !== id);
            }),
        );
        vi.stubGlobal(
            "MutationObserver",
            MutationObserverMock as unknown as typeof MutationObserver,
        );
        vi.stubGlobal("document", {
            body: {},
            documentElement: {},
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    test("restores scroll after delayed content growth", () => {
        const log = makeLogger();
        const element = makeScrollableElement({
            clientHeight: 100,
            scrollHeight: 100,
        });

        tryScroll(log, () => element as HTMLElement, 400);
        flushAnimationFrames();

        vi.advanceTimersByTime(2000);
        flushAnimationFrames();

        expect(element.scrollTop).toBe(0);
        expect(log.warn).not.toHaveBeenCalled();

        element.scrollHeight = 700;
        vi.advanceTimersByTime(100);
        flushAnimationFrames();

        expect(element.scrollTop).toBe(400);
        expect(log.info).toHaveBeenCalledWith(
            "scroll restored",
            expect.objectContaining({
                target: 400,
                actual: 400,
            }),
        );
        expect(log.warn).not.toHaveBeenCalled();
    });

    test("waits for the scrollable element to appear", () => {
        const log = makeLogger();
        let element: ScrollableElementLike | null = null;

        tryScroll(log, () => element as HTMLElement | null, 120);
        flushAnimationFrames();

        expect(log.warn).not.toHaveBeenCalled();

        element = makeScrollableElement({
            clientHeight: 100,
            scrollHeight: 500,
        });
        MutationObserverMock.triggerAll();
        flushAnimationFrames();

        expect(element.scrollTop).toBe(120);
        expect(log.info).toHaveBeenCalledWith(
            "scroll restored",
            expect.objectContaining({
                target: 120,
                actual: 120,
            }),
        );
    });

    test("cancels the previous pending restoration", () => {
        const log = makeLogger();
        const firstElement = makeScrollableElement({
            clientHeight: 100,
            scrollHeight: 100,
        });
        const secondElement = makeScrollableElement({
            clientHeight: 100,
            scrollHeight: 100,
        });

        tryScroll(log, () => firstElement as HTMLElement, 400);
        flushAnimationFrames();

        tryScroll(log, () => secondElement as HTMLElement, 120);
        flushAnimationFrames();

        firstElement.scrollHeight = 800;
        secondElement.scrollHeight = 500;
        MutationObserverMock.triggerAll();
        flushAnimationFrames();

        expect(firstElement.scrollTop).toBe(0);
        expect(secondElement.scrollTop).toBe(120);
        expect(log.warn).not.toHaveBeenCalled();
    });

    test("stops trying after explicit cancellation", () => {
        const log = makeLogger();
        const element = makeScrollableElement({
            clientHeight: 100,
            scrollHeight: 100,
        });

        tryScroll(log, () => element as HTMLElement, 240);
        flushAnimationFrames();

        cancelTryScroll();
        element.scrollHeight = 500;
        MutationObserverMock.triggerAll();
        vi.advanceTimersByTime(500);
        flushAnimationFrames();

        expect(element.scrollTop).toBe(0);
        expect(log.info).not.toHaveBeenCalledWith(
            "scroll restored",
            expect.objectContaining({
                target: 240,
            }),
        );
    });
});

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

function makeScrollableElement({
    clientHeight,
    scrollHeight,
}: {
    clientHeight: number;
    scrollHeight: number;
}): ScrollableElementLike {
    let currentScrollTop = 0;

    return {
        clientHeight,
        scrollHeight,
        get scrollTop(): number {
            return currentScrollTop;
        },
        set scrollTop(nextScrollTop: number) {
            const maxScrollTop = Math.max(0, this.scrollHeight - this.clientHeight);
            currentScrollTop = Math.max(0, Math.min(nextScrollTop, maxScrollTop));
        },
    };
}

function flushAnimationFrames(now = 0): void {
    while (pendingFrames.length > 0) {
        const frames = pendingFrames;
        pendingFrames = [];
        for (const { callback } of frames) {
            callback(now);
        }
    }
}
