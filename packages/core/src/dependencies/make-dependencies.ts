/**
 * 依赖工厂 — 创建所有基础依赖
 */

import { getLocaleAttributes } from "../i18n/locale";
import { resolveMessages, type TranslationMessages } from "../i18n/messages";
import { SimpleTranslator } from "../i18n/translator";
import type { LocaleAttributes, Translator } from "../i18n/types";
import { CompositeLoggerFactory } from "../logger/composite";
import { ConsoleLoggerFactory } from "../logger/console";
import { ReportingLoggerFactory, type ReportCallback } from "../logger/reporting";
import type { Logger, LoggerFactory } from "../logger/types";
import { ConsoleEventRecorder } from "../metrics/console-recorder";
import type { EventRecorder } from "../metrics/types";
import { detectPlatform, type PlatformInfo } from "../utils/platform";
import { Container } from "./container";

// ===== 重新导出 Logger 类型 =====
export type { Logger, LoggerFactory };
export type { TranslationMessages } from "../i18n/messages";

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
    EVENT_RECORDER: "eventRecorder",
    LOCALE: "locale",
    PLATFORM: "platform",
    TRANSLATOR: "translator",
} as const;

// ===== 默认实现 =====

class MemoryStorage implements Storage {
    private store = new Map<string, string>();
    get(key: string) {
        return this.store.get(key);
    }
    set(key: string, value: string) {
        this.store.set(key, value);
    }
    delete(key: string) {
        this.store.delete(key);
    }
}

class DefaultFeatureFlags implements FeatureFlags {
    private flags: Record<string, boolean | string | number>;
    private providers: FeatureFlagsProvider[] = [];

    constructor(flags: Record<string, boolean | string | number> = {}) {
        this.flags = flags;
    }

    /** 注册外部 provider（如远程配置、A/B 测试 SDK） */
    addProvider(provider: FeatureFlagsProvider): void {
        this.providers.push(provider);
    }

    isEnabled(key: string) {
        // 先查外部 provider（后注册的优先）
        for (let i = this.providers.length - 1; i >= 0; i--) {
            const result = this.providers[i].isEnabled(key);
            if (result) return true;
        }
        return this.flags[key] === true;
    }
    getString(key: string) {
        for (let i = this.providers.length - 1; i >= 0; i--) {
            const result = this.providers[i].getString?.(key);
            if (result !== undefined) return result;
        }
        const v = this.flags[key];
        return typeof v === "string" ? v : undefined;
    }
    getNumber(key: string) {
        for (let i = this.providers.length - 1; i >= 0; i--) {
            const result = this.providers[i].getNumber?.(key);
            if (result !== undefined) return result;
        }
        const v = this.flags[key];
        return typeof v === "number" ? v : undefined;
    }
}

class ConsoleMetrics implements MetricsRecorder {
    record(type: string, fields?: Record<string, unknown>) {
        console.info(`[Metrics:${type}]`, fields ?? "");
    }
    recordPageView(page: string, fields?: Record<string, unknown>) {
        this.record("PageView", { page, ...fields });
    }
    recordEvent(name: string, fields?: Record<string, unknown>) {
        this.record("Event", { name, ...fields });
    }
}

// ===== 依赖工厂 =====

export interface MakeDependenciesOptions {
    fetch?: typeof globalThis.fetch;
    featureFlags?: Record<string, boolean | string | number>;
    /** 外部 feature flags providers（远程配置、A/B 测试等） */
    featureFlagsProviders?: FeatureFlagsProvider[];
    /** 日志上报回调 — 提供后自动组合 ReportingLoggerFactory */
    reportCallback?: ReportCallback;
    /** 自定义 EventRecorder（默认 ConsoleEventRecorder） */
    eventRecorder?: EventRecorder;
    /** 语言代码（如 "zh-Hans"、"en-US"），用于注入 locale 信息 */
    locale?: string;
    /** 自定义 PlatformInfo（默认通过 UA 自动检测） */
    platform?: PlatformInfo;
}

interface InternalMakeDependenciesOptions extends MakeDependenciesOptions {
    _resolvedMessages?: TranslationMessages;
}

export function makeDependencies(
    container: Container,
    options: MakeDependenciesOptions = {},
): void {
    const { _resolvedMessages: messages } = options as InternalMakeDependenciesOptions;
    const {
        fetch: fetchFn = globalThis.fetch?.bind(globalThis),
        featureFlags = {},
        featureFlagsProviders = [],
        reportCallback,
        eventRecorder,
        locale,
        platform,
    } = options;

    // ===== Logger =====
    const consoleFactory = new ConsoleLoggerFactory();
    const loggerFactory: LoggerFactory = reportCallback
        ? new CompositeLoggerFactory([
              consoleFactory,
              new ReportingLoggerFactory({ report: reportCallback }),
          ])
        : consoleFactory;

    container.register<LoggerFactory>(DEP_KEYS.LOGGER_FACTORY, () => loggerFactory);

    container.register<Logger>(DEP_KEYS.LOGGER, () => loggerFactory.loggerFor("framework"));

    // ===== Network =====
    container.register<Net>(DEP_KEYS.NET, () => ({
        fetch: (url: string, opts?: RequestInit) => fetchFn(url, opts),
    }));

    container.register<Storage>(DEP_KEYS.STORAGE, () => new MemoryStorage());

    // ===== Feature Flags =====
    const flags = new DefaultFeatureFlags(featureFlags);
    for (const provider of featureFlagsProviders) {
        flags.addProvider(provider);
    }
    container.register<FeatureFlags>(DEP_KEYS.FEATURE_FLAGS, () => flags);

    // ===== Metrics (legacy) =====
    container.register<MetricsRecorder>(DEP_KEYS.METRICS, () => new ConsoleMetrics());

    // ===== EventRecorder (new metrics pipeline) =====
    container.register<EventRecorder>(
        DEP_KEYS.EVENT_RECORDER,
        () => eventRecorder ?? new ConsoleEventRecorder(),
    );

    // ===== Locale =====
    if (locale) {
        container.register<LocaleAttributes>(DEP_KEYS.LOCALE, () => getLocaleAttributes(locale));
    }

    // ===== Translator =====
    if (locale && messages) {
        const flat = resolveMessages(messages, locale);
        if (flat) {
            container.register<Translator>(
                DEP_KEYS.TRANSLATOR,
                () => new SimpleTranslator({ locale, messages: flat }),
            );
        }
    }

    // ===== Platform =====
    container.register<PlatformInfo>(
        DEP_KEYS.PLATFORM,
        () =>
            platform ??
            detectPlatform(typeof navigator !== "undefined" ? navigator.userAgent : undefined),
    );

    container.register(DEP_KEYS.FETCH, () => fetchFn);
}
