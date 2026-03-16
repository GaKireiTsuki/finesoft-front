/**
 * BaseLogger — 抽象日志基类
 */

import type { Logger } from "./types";

export abstract class BaseLogger implements Logger {
	protected category: string;

	constructor(category: string) {
		this.category = category;
	}

	abstract debug(...args: unknown[]): string;
	abstract info(...args: unknown[]): string;
	abstract warn(...args: unknown[]): string;
	abstract error(...args: unknown[]): string;
}
