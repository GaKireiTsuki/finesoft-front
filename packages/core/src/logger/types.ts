/** 日志级别 */
export type Level = "debug" | "info" | "warn" | "error";

/**
 * Logger 接口
 *
 * Logging is observational and does not produce presentation output.
 */
export interface Logger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

export interface LoggerFactory {
    loggerFor(category: string): Logger;
}
