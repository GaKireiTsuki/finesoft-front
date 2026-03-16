/**
 * Composite Logger — 组合日志，广播到多个后端
 */

import type { Logger, LoggerFactory } from "./types";

export class CompositeLoggerFactory implements LoggerFactory {
	constructor(private readonly factories: LoggerFactory[]) {}

	loggerFor(name: string): Logger {
		return new CompositeLogger(
			this.factories.map((f) => f.loggerFor(name)),
		);
	}
}

export class CompositeLogger implements Logger {
	constructor(private readonly loggers: Logger[]) {}

	debug(...args: unknown[]): string {
		return this.callAll("debug", args);
	}

	info(...args: unknown[]): string {
		return this.callAll("info", args);
	}

	warn(...args: unknown[]): string {
		return this.callAll("warn", args);
	}

	error(...args: unknown[]): string {
		return this.callAll("error", args);
	}

	private callAll(
		method: "debug" | "info" | "warn" | "error",
		args: unknown[],
	): string {
		for (const logger of this.loggers) {
			logger[method](...args);
		}
		return "";
	}
}
