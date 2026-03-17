/**
 * 依赖工厂 — 创建所有基础依赖
 */

import { ConsoleLoggerFactory } from "../logger/console";
import type { Logger, LoggerFactory } from "../logger/types";
import { Container } from "./container";

// ===== 重新导出 Logger 类型 =====
export type { Logger, LoggerFactory };

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

/** Metrics 记录器 */
export interface MetricsRecorder {
    recordPageView(page: string, fields?: Record<string, unknown>): void;
    recordEvent(name: string, fields?: Record<string, unknown>): void;
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
    constructor(flags: Record<string, boolean | string | number> = {}) {
        this.flags = flags;
    }
    isEnabled(key: string) {
        return this.flags[key] === true;
    }
    getString(key: string) {
        const v = this.flags[key];
        return typeof v === "string" ? v : undefined;
    }
    getNumber(key: string) {
        const v = this.flags[key];
        return typeof v === "number" ? v : undefined;
    }
}

class ConsoleMetrics implements MetricsRecorder {
    recordPageView(page: string, fields?: Record<string, unknown>) {
        console.info(`[Metrics:PageView] ${page}`, fields ?? "");
    }
    recordEvent(name: string, fields?: Record<string, unknown>) {
        console.info(`[Metrics:Event] ${name}`, fields ?? "");
    }
}

// ===== 依赖工厂 =====

export interface MakeDependenciesOptions {
    fetch?: typeof globalThis.fetch;
    featureFlags?: Record<string, boolean | string | number>;
}

export function makeDependencies(
    container: Container,
    options: MakeDependenciesOptions = {},
): void {
    const { fetch: fetchFn = globalThis.fetch?.bind(globalThis), featureFlags = {} } = options;

    const loggerFactory = new ConsoleLoggerFactory();
    container.register<LoggerFactory>(DEP_KEYS.LOGGER_FACTORY, () => loggerFactory);

    container.register<Logger>(DEP_KEYS.LOGGER, () => loggerFactory.loggerFor("framework"));

    container.register<Net>(DEP_KEYS.NET, () => ({
        fetch: (url: string, opts?: RequestInit) => fetchFn(url, opts),
    }));

    container.register<Storage>(DEP_KEYS.STORAGE, () => new MemoryStorage());

    container.register<FeatureFlags>(
        DEP_KEYS.FEATURE_FLAGS,
        () => new DefaultFeatureFlags(featureFlags),
    );

    container.register<MetricsRecorder>(DEP_KEYS.METRICS, () => new ConsoleMetrics());

    container.register(DEP_KEYS.FETCH, () => fetchFn);
}
