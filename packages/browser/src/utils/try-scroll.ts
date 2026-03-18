/**
 * tryScroll — 框架级滚动位置恢复
 *
 * 基于 ResizeObserver 的事件驱动方案：
 * - 监听滚动容器尺寸变化（覆盖图片加载、懒组件、字体渲染、CSS 动画等全部场景）
 * - 首帧同步尝试（内容已就绪时零延迟恢复）
 * - 超时兜底：5 秒后放弃并滚动到能到达的最远位置
 */

import type { Logger } from "@finesoft/core";

/** 最大等待时间 (ms) */
const MAX_WAIT_MS = 5000;
/** 滚动位置容差 (px) */
const FUDGE = 16;

let teardown: (() => void) | null = null;

export function tryScroll(
    log: Logger,
    getScrollableElement: () => HTMLElement | null,
    scrollY: number,
): void {
    // 取消上一次未完成的滚动恢复
    if (teardown) {
        teardown();
        teardown = null;
    }

    // scrollY <= 0: 直接归顶，无需等待
    if (scrollY <= 0) {
        const el = getScrollableElement();
        if (el) el.scrollTop = 0;
        return;
    }

    const el = getScrollableElement();
    if (!el) {
        log.warn("could not restore scroll: scrollable element missing");
        return;
    }

    // ── 尝试滚动 ──

    function attemptScroll(): boolean {
        if (!el) return false;
        if (scrollY + el.offsetHeight <= el.scrollHeight + FUDGE) {
            el.scrollTop = scrollY;
            log.info("scroll restored to", scrollY);
            return true;
        }
        return false;
    }

    // 首帧同步尝试 — SSR hydration 后内容通常已就绪
    if (attemptScroll()) return;

    // ── ResizeObserver 驱动 ──

    let resizeObserver: ResizeObserver | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function cleanup() {
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        teardown = null;
    }

    resizeObserver = new ResizeObserver(() => {
        if (attemptScroll()) {
            cleanup();
        }
    });
    resizeObserver.observe(el);

    // 超时兜底：滚动到能到达的最远位置
    timeoutId = setTimeout(() => {
        log.warn(
            `tryScroll: timed out after ${MAX_WAIT_MS}ms, target=${scrollY}, ` +
                `scrollHeight=${el.scrollHeight}`,
        );
        // 尽力滚动到最远位置
        el.scrollTop = el.scrollHeight;
        cleanup();
    }, MAX_WAIT_MS);

    teardown = cleanup;
}
