/**
 * ConsoleLogger — 基于 console 的日志实现
 */

import { BaseLogger } from "./base";
export type LogFilter = (category: string, level: "debug" | "info" | "warn" | "error") => boolean;
import type { Logger, LoggerFactory } from "./types";

export class ConsoleLogger extends BaseLogger {
    constructor(
        category: string,
        private readonly shouldLog: LogFilter = () => true,
    ) {
        super(category);
    }
    debug(...args: unknown[]): string {
        if (this.shouldLog(this.category, "debug")) {
            console.debug(`[${this.category}]`, ...args);
        }
        return "";
    }

    info(...args: unknown[]): string {
        if (this.shouldLog(this.category, "info")) {
            console.info(`[${this.category}]`, ...args);
        }
        return "";
    }

    warn(...args: unknown[]): string {
        if (this.shouldLog(this.category, "warn")) {
            console.warn(`[${this.category}]`, ...args);
        }
        return "";
    }

    error(...args: unknown[]): string {
        console.error(`[${this.category}]`, ...args);
        return "";
    }
}

export class ConsoleLoggerFactory implements LoggerFactory {
    constructor(private readonly shouldLog: LogFilter = () => true) {}
    loggerFor(category: string): Logger {
        return new ConsoleLogger(category, this.shouldLog);
    }
}
