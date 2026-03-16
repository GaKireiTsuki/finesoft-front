/**
 * ConsoleLogger — 基于 console 的日志实现
 */

import { BaseLogger } from "./base";
import { shouldLog } from "./local-storage-filter";
import type { Logger, LoggerFactory } from "./types";

export class ConsoleLogger extends BaseLogger {
    debug(...args: unknown[]): string {
        if (shouldLog(this.category, "debug")) {
            console.debug(`[${this.category}]`, ...args);
        }
        return "";
    }

    info(...args: unknown[]): string {
        if (shouldLog(this.category, "info")) {
            console.info(`[${this.category}]`, ...args);
        }
        return "";
    }

    warn(...args: unknown[]): string {
        if (shouldLog(this.category, "warn")) {
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
    loggerFor(category: string): Logger {
        return new ConsoleLogger(category);
    }
}
