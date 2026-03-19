/**
 * Metrics — 类型定义
 *
 * 框架级埋点基础设施的核心接口。
 */

/** 事件记录器 — 所有 metrics 后端实现此接口 */
export interface EventRecorder {
    /** 记录一条事件 */
    record(type: string, fields?: Record<string, unknown>): void;
    /** 刷新待发送的事件队列 */
    flush?(): Promise<void>;
    /** 销毁记录器，释放资源 */
    destroy?(): void;
}

/** 字段提供者 — 每次记录前自动注入公共字段 */
export interface MetricsFieldsProvider {
    /** 返回需要附加到每条事件的字段 */
    getFields(): Record<string, unknown>;
}

/** Impression 条目 */
export interface ImpressionEntry {
    /** 被追踪元素的唯一标识 */
    id: string;
    /** 元素进入视口的时间戳 */
    timestamp: number;
    /** 附加数据 */
    metadata?: Record<string, unknown>;
}

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
