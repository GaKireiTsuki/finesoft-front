import type { ImpressionEntry } from "@finesoft/core";
/** Impression 观察器 — 追踪元素可见性 */
export interface ImpressionObserver {
    /** 开始追踪一个元素 */
    observe(element: Element, id: string, metadata?: Record<string, unknown>): void;
    /** 停止追踪一个元素 */
    unobserve(element: Element): void;
    /** 获取已捕获的曝光并清空 */
    consume(): ImpressionEntry[];
    /** 销毁观察器 */
    destroy(): void;
}
