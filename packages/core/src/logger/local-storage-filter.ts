/**
 * localStorage 日志级别过滤
 *
 * 通过 localStorage.onyxLog 控制日志级别:
 *   '*=info'              — 全局 info 及以上
 *   '*=info,Foo=off'      — 全局 info，Foo 静默
 *   'Bar=error,Baz=warn'  — Bar 只输出 error，Baz 输出 warn+
 */

import type { Level } from "./types";

type LevelNum = 4 | 3 | 2 | 1 | 0;

const LEVEL_TO_NUM: Record<string, LevelNum> = {
	"*": 4,
	debug: 4,
	info: 3,
	warn: 2,
	error: 1,
	off: 0,
	"": 0,
};

interface Rules {
	named?: Record<string, LevelNum>;
	defaultLevel?: LevelNum;
}

let cachedRules: Rules | undefined;
let cachedRaw: string | undefined;

function parseRules(): Rules {
	if (typeof globalThis.localStorage === "undefined") {
		return {};
	}

	let raw: string | null;
	try {
		raw = globalThis.localStorage.getItem("onyxLog");
	} catch {
		return {};
	}

	if (!raw) return {};

	if (raw === cachedRaw && cachedRules) return cachedRules;
	cachedRaw = raw;

	const rules: Rules = {};
	const parts = raw.split(",");

	for (const part of parts) {
		const [name, level] = part.trim().split("=");
		if (!name || level === undefined) continue;

		const num = LEVEL_TO_NUM[level.toLowerCase()] ?? undefined;
		if (num === undefined) continue;

		if (name === "*") {
			rules.defaultLevel = num;
		} else {
			rules.named ??= {};
			rules.named[name] = num;
		}
	}

	cachedRules = rules;
	return rules;
}

export function shouldLog(name: string, level: Level): boolean {
	const rules = parseRules();

	if (rules.defaultLevel === undefined && !rules.named) {
		return true;
	}

	const currentNum = LEVEL_TO_NUM[level] ?? 4;

	if (rules.named?.[name] !== undefined) {
		return currentNum <= rules.named[name];
	}

	if (rules.defaultLevel !== undefined) {
		return currentNum <= rules.defaultLevel;
	}

	return true;
}

export function resetFilterCache(): void {
	cachedRules = undefined;
	cachedRaw = undefined;
}
