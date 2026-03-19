/**
 * IntersectionImpressionObserver — 基于 IntersectionObserver 的曝光追踪
 */

import type { ImpressionEntry, ImpressionObserver } from "./types";

export interface ImpressionObserverOptions {
    /** 可见比例阈值（0~1），默认 0.5 */
    threshold?: number;
    /** 最小可见时长（毫秒），默认 1000 */
    minVisibleDuration?: number;
}

interface TrackedEntry {
    id: string;
    metadata?: Record<string, unknown>;
    visibleSince: number | null;
}

export class IntersectionImpressionObserver implements ImpressionObserver {
    private readonly observer: IntersectionObserver;
    private readonly tracked = new Map<Element, TrackedEntry>();
    private readonly captured: ImpressionEntry[] = [];
    private readonly minDuration: number;

    constructor(options: ImpressionObserverOptions = {}) {
        this.minDuration = options.minVisibleDuration ?? 1000;

        this.observer = new IntersectionObserver(
            (entries) => {
                const now = Date.now();
                for (const entry of entries) {
                    const tracked = this.tracked.get(entry.target);
                    if (!tracked) continue;

                    if (entry.isIntersecting) {
                        if (tracked.visibleSince === null) {
                            tracked.visibleSince = now;
                        }
                    } else {
                        if (tracked.visibleSince !== null) {
                            const duration = now - tracked.visibleSince;
                            if (duration >= this.minDuration) {
                                this.captured.push({
                                    id: tracked.id,
                                    timestamp: tracked.visibleSince,
                                    metadata: tracked.metadata,
                                });
                            }
                            tracked.visibleSince = null;
                        }
                    }
                }
            },
            { threshold: options.threshold ?? 0.5 },
        );
    }

    observe(element: Element, id: string, metadata?: Record<string, unknown>): void {
        this.tracked.set(element, { id, metadata, visibleSince: null });
        this.observer.observe(element);
    }

    unobserve(element: Element): void {
        this.observer.unobserve(element);
        this.tracked.delete(element);
    }

    consume(): ImpressionEntry[] {
        const now = Date.now();
        // Flush currently visible entries that have met the duration threshold
        for (const [, tracked] of this.tracked) {
            if (tracked.visibleSince !== null) {
                const duration = now - tracked.visibleSince;
                if (duration >= this.minDuration) {
                    this.captured.push({
                        id: tracked.id,
                        timestamp: tracked.visibleSince,
                        metadata: tracked.metadata,
                    });
                    tracked.visibleSince = now;
                }
            }
        }
        return this.captured.splice(0);
    }

    destroy(): void {
        this.observer.disconnect();
        this.tracked.clear();
        this.captured.length = 0;
    }
}
