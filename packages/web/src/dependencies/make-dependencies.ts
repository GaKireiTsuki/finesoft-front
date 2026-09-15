import type { LogFilter } from "@finesoft/core";
/**
 * 依赖工厂 — 创建所有基础依赖
 */

import { secureFetch, type SecureFetchOptions } from "@finesoft/core";
import { getLocaleAttributes } from "@finesoft/core";
import { resolveMessages, type TranslationMessages } from "@finesoft/core";
import { SimpleTranslator } from "@finesoft/core";
import type { LocaleAttributes, Translator } from "@finesoft/core";
import { CompositeLoggerFactory } from "@finesoft/core";
import { ConsoleLoggerFactory } from "@finesoft/core";
import { ReportingLoggerFactory, type ReportCallback } from "@finesoft/core";
import type { Logger, LoggerFactory } from "@finesoft/core";
import { ConsoleEventRecorder } from "@finesoft/core";
import type { EventRecorder } from "@finesoft/core";
import { detectPlatform, type PlatformInfo } from "@finesoft/core";
import { Container } from "@finesoft/core";

import {
    DEP_KEYS,
    type Net,
    type Storage,
    type FeatureFlags,
    type FeatureFlagsProvider,
    type MetricsRecorder,
} from "@finesoft/core";
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
    logFilter?: LogFilter;
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
    /**
     * 覆盖 `DEP_KEYS.SAFE_FETCH` 默认行为。比如服务正常需要打内网，可以传
     * `{ allowInternalHosts: true }` 整体放行；或自定义 DNS 校验策略。
     */
    safeFetch?: SecureFetchOptions;
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
    const consoleFactory = new ConsoleLoggerFactory(options.logFilter);
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
    container.register<PlatformInfo>(DEP_KEYS.PLATFORM, () => platform ?? detectPlatform());

    container.register(DEP_KEYS.FETCH, () => fetchFn);

    // ===== SAFE_FETCH (SSRF-defended wrapper around FETCH) =====
    const safeFetchOpts = options.safeFetch ?? {};
    container.register<typeof globalThis.fetch>(DEP_KEYS.SAFE_FETCH, () =>
        secureFetch(fetchFn, safeFetchOpts),
    );
}
