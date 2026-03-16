/** 日志级别 */
export type Level = "debug" | "info" | "warn" | "error";

/**
 * Logger 接口
 *
 * 所有方法返回空字符串，允许在模板中内联使用而不渲染文本。
 */
export interface Logger {
	debug(...args: unknown[]): string;
	info(...args: unknown[]): string;
	warn(...args: unknown[]): string;
	error(...args: unknown[]): string;
}

export interface LoggerFactory {
	loggerFor(category: string): Logger;
}
