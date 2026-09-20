/**
 * ConsoleLogger — 基于 console 的日志实现
 */

import type { Logger, LoggerFactory } from "./types";

export type LogFilter = (category: string, level: "debug" | "info" | "warn" | "error") => boolean;

export class ConsoleLogger implements Logger {
    constructor(
        private readonly category: string,
        private readonly shouldLog: LogFilter = () => true,
    ) {}
    debug(...args: unknown[]): void {
        if (this.shouldLog(this.category, "debug")) {
            console.debug(`[${this.category}]`, ...args);
        }
    }

    info(...args: unknown[]): void {
        if (this.shouldLog(this.category, "info")) {
            console.info(`[${this.category}]`, ...args);
        }
    }

    warn(...args: unknown[]): void {
        if (this.shouldLog(this.category, "warn")) {
            console.warn(`[${this.category}]`, ...args);
        }
    }

    error(...args: unknown[]): void {
        console.error(`[${this.category}]`, ...args);
    }
}

export class ConsoleLoggerFactory implements LoggerFactory {
    constructor(private readonly shouldLog: LogFilter = () => true) {}
    loggerFor(category: string): Logger {
        return new ConsoleLogger(category, this.shouldLog);
    }
}
