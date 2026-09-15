import type { Logger, LoggerFactory } from "../logger/types";
// ===== 重新导出 Logger 类型 =====
export type { Logger, LoggerFactory };
export type { TranslationMessages } from "../../../core/src/i18n/messages";

// ===== 依赖接口 =====

/** 网络请求层 */
export interface Net {
    fetch(url: string, options?: RequestInit): Promise<Response>;
}

/** 存储接口 */
export interface Storage {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
}

/** Feature Flags */
export interface FeatureFlags {
    isEnabled(key: string): boolean;
    getString(key: string): string | undefined;
    getNumber(key: string): number | undefined;
}

/** Feature Flags Provider — 用于从远程/外部源加载 flags */
export interface FeatureFlagsProvider {
    isEnabled(key: string): boolean;
    getString?(key: string): string | undefined;
    getNumber?(key: string): number | undefined;
}

/** Metrics 记录器 */
export interface MetricsRecorder {
    /** 记录一条事件（通用方法） */
    record(type: string, fields?: Record<string, unknown>): void;
    /** 记录页面访问（便捷方法） */
    recordPageView(page: string, fields?: Record<string, unknown>): void;
    /** 记录自定义事件（便捷方法） */
    recordEvent(name: string, fields?: Record<string, unknown>): void;
    /** 刷新待发送队列 */
    flush?(): Promise<void>;
    /** 销毁记录器 */
    destroy?(): void;
}

// ===== 依赖 Key 常量 =====

export const DEP_KEYS = {
    LOGGER: "logger",
    LOGGER_FACTORY: "loggerFactory",
    NET: "net",
    STORAGE: "storage",
    FEATURE_FLAGS: "featureFlags",
    METRICS: "metrics",
    FETCH: "fetch",
    /**
     * `fetch` 包了 SSRF 防护（拒绝 private / loopback / 保留 IP + DNS resolve 后逐 IP 校验）。
     * 当 controller 用用户可控的 URL 发起请求（图片代理、链接预览、回调等），
     * 优先 resolve 这个 key 而不是 `FETCH`。要 opt-out 可手动调 `secureFetch(baseFetch, { allowInternalHosts: true })`。
     */
    SAFE_FETCH: "safeFetch",
    EVENT_RECORDER: "eventRecorder",
    LOCALE: "locale",
    PLATFORM: "platform",
    TRANSLATOR: "translator",
} as const;
