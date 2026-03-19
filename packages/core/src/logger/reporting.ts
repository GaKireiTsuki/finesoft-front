/**
 * ReportingLogger — 上报型日志实现
 *
 * 将 warn/error 级别日志转发到外部监控服务（如 Sentry、Datadog）。
 * 用户通过 ReportCallback 注入上报逻辑，框架不直接依赖任何第三方 SDK。
 */

import { BaseLogger } from "./base";
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

export class ReportingLogger extends BaseLogger {
    private readonly minPriority: number;
    private readonly report: ReportCallback;

    constructor(category: string, options: ReportingLoggerOptions) {
        super(category);
        this.minPriority = LEVEL_PRIORITY[options.minLevel ?? "warn"];
        this.report = options.report;
    }

    debug(...args: unknown[]): string {
        this.maybeReport("debug", args);
        return "";
    }

    info(...args: unknown[]): string {
        this.maybeReport("info", args);
        return "";
    }

    warn(...args: unknown[]): string {
        this.maybeReport("warn", args);
        return "";
    }

    error(...args: unknown[]): string {
        this.maybeReport("error", args);
        return "";
    }

    private maybeReport(level: Level, args: unknown[]): void {
        if (LEVEL_PRIORITY[level] >= this.minPriority) {
            this.report(level, this.category, args);
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
