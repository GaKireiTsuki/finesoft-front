/**
 * ReportingLogger — 上报型日志实现
 *
 * 将 warn/error 级别日志转发到外部监控服务（如 Sentry、Datadog）。
 * 用户通过 ReportCallback 注入上报逻辑，框架不直接依赖任何第三方 SDK。
 */

import type { Level, Logger, LoggerFactory } from "./types";

/** 日志上报回调 */
export interface ReportCallback {
    (level: Level, category: string, args: unknown[]): void;
}

/** 配置 */
export interface ReportingLoggerOptions {
    /** 最低上报级别（默认 "warn"） */
    minLevel?: Level;
    /** 上报回调 */
    report: ReportCallback;
}

const LEVEL_PRIORITY: Record<Level, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

export class ReportingLogger implements Logger {
    private readonly minPriority: number;
    private readonly report: ReportCallback;

    constructor(
        private readonly category: string,
        options: ReportingLoggerOptions,
    ) {
        this.minPriority = LEVEL_PRIORITY[options.minLevel ?? "warn"];
        this.report = options.report;
    }

    debug(...args: unknown[]): void {
        this.maybeReport("debug", args);
    }

    info(...args: unknown[]): void {
        this.maybeReport("info", args);
    }

    warn(...args: unknown[]): void {
        this.maybeReport("warn", args);
    }

    error(...args: unknown[]): void {
        this.maybeReport("error", args);
    }

    private maybeReport(level: Level, args: unknown[]): void {
        if (LEVEL_PRIORITY[level] < this.minPriority) return;
        // 日志是横切关注点：上报失败不应让业务流崩溃。
        // 用 console.error 直接打到控制台，避免回调到 logger 造成无限递归。
        try {
            this.report(level, this.category, args);
        } catch (e) {
            console.error("[ReportingLogger] report callback threw:", e);
        }
    }
}

export class ReportingLoggerFactory implements LoggerFactory {
    private readonly options: ReportingLoggerOptions;

    constructor(options: ReportingLoggerOptions) {
        this.options = options;
    }

    loggerFor(category: string): Logger {
        return new ReportingLogger(category, this.options);
    }
}
