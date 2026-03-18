import type { Logger } from "@finesoft/core";

const MAX_WAIT_MS = 5000;
const POLL_INTERVAL_MS = 100;
const SCROLL_TOLERANCE = 2;

type Cleanup = () => void;

let pendingCleanup: Cleanup | null = null;

export function cancelTryScroll(): void {
    pendingCleanup?.();
}

export function tryScroll(
    log: Logger,
    getScrollableElement: () => HTMLElement | null,
    scrollY: number,
): void {
    cancelTryScroll();

    const target = Math.max(0, scrollY);
    const startedAt = Date.now();

    let disposed = false;
    let pendingFrame: number | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let mutationObserver: MutationObserver | null = null;

    pendingCleanup = cleanup;

    observeDocumentActivity();
    document.addEventListener("load", scheduleAttempt, true);
    intervalId = setInterval(scheduleAttempt, POLL_INTERVAL_MS);
    timeoutId = setTimeout(scheduleAttempt, MAX_WAIT_MS);
    scheduleAttempt();

    function scheduleAttempt(): void {
        if (disposed || pendingFrame !== null) {
            return;
        }

        pendingFrame = requestAnimationFrame(() => {
            pendingFrame = null;
            attemptRestore();
        });
    }

    function attemptRestore(): void {
        if (disposed) {
            return;
        }

        const elapsedMs = Date.now() - startedAt;
        const element = getScrollableElement();

        if (!element) {
            if (elapsedMs >= MAX_WAIT_MS) {
                log.warn("tryScroll: timed out waiting for the scrollable element", {
                    target,
                    elapsedMs,
                });
                cleanup();
            }
            return;
        }

        element.scrollTop = target;
        const actual = element.scrollTop;

        if (actual >= target - SCROLL_TOLERANCE) {
            log.info("scroll restored", {
                target,
                actual,
                elapsedMs,
            });
            cleanup();
            return;
        }

        if (elapsedMs >= MAX_WAIT_MS) {
            log.warn("tryScroll: timed out before reaching the target", {
                target,
                actual,
                elapsedMs,
                scrollHeight: element.scrollHeight,
                clientHeight: element.clientHeight,
            });
            cleanup();
        }
    }

    function observeDocumentActivity(): void {
        if (typeof MutationObserver === "undefined") {
            return;
        }

        const root = document.body ?? document.documentElement;
        if (!root) {
            return;
        }

        // Watch for async DOM/layout work instead of relying on a fixed frame budget.
        mutationObserver = new MutationObserver(() => {
            scheduleAttempt();
        });
        mutationObserver.observe(root, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
        });
    }

    function cleanup(): void {
        if (disposed) {
            return;
        }

        disposed = true;

        if (pendingCleanup === cleanup) {
            pendingCleanup = null;
        }

        if (pendingFrame !== null) {
            cancelAnimationFrame(pendingFrame);
            pendingFrame = null;
        }

        if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
        }

        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }

        mutationObserver?.disconnect();
        mutationObserver = null;
        document.removeEventListener("load", scheduleAttempt, true);
    }
}
