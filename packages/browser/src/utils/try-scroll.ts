/**
 * tryScroll — 渐进式滚动位置恢复
 *
 * 使用 rAF 循环等待页面高度足够后恢复滚动位置。
 */

import type { Logger } from "@finesoft/core";

const MAX_TRIES = 100;
const FUDGE = 16;

let pendingFrame: number | null = null;

export function tryScroll(
	log: Logger,
	getScrollableElement: () => HTMLElement | null,
	scrollY: number,
): void {
	if (pendingFrame !== null) {
		cancelAnimationFrame(pendingFrame);
		pendingFrame = null;
	}

	let tries = 0;

	pendingFrame = requestAnimationFrame(function attempt() {
		if (++tries >= MAX_TRIES) {
			log.warn(
				`tryScroll: gave up after ${MAX_TRIES} frames, target=${scrollY}`,
			);
			pendingFrame = null;
			return;
		}

		const el = getScrollableElement();
		if (!el) {
			log.warn(
				"could not restore scroll: the scrollable element is missing",
			);
			return;
		}

		const { scrollHeight, offsetHeight } = el;
		const canScroll = scrollY + offsetHeight <= scrollHeight + FUDGE;

		if (!canScroll) {
			log.info("page is not tall enough for scroll yet", {
				scrollHeight,
				offsetHeight,
			});
			pendingFrame = requestAnimationFrame(attempt);
			return;
		}

		el.scrollTop = scrollY;
		log.info("scroll restored to", scrollY);
		pendingFrame = null;
	});
}
