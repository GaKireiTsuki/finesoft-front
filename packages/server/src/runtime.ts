/**
 * runtime — 运行时检测 + 项目根路径推导
 */

export interface RuntimeInfo {
	isDeno: boolean;
	isBun: boolean;
	isVercel: boolean;
	isProduction: boolean;
}

/** 检测当前运行时环境 */
export function detectRuntime(): RuntimeInfo {
	return {
		isDeno: typeof (globalThis as any).Deno !== "undefined",
		isBun: typeof (globalThis as any).Bun !== "undefined",
		isVercel: !!process.env.VERCEL,
		isProduction: process.env.NODE_ENV === "production",
	};
}

/**
 * 从 `import.meta.url` 推导项目根路径
 *
 * @param importMetaUrl - 调用方的 `import.meta.url`
 * @param levelsUp - 向上移动多少级（默认 0，即调用方所在目录就是项目根）
 */
export async function resolveRoot(
	importMetaUrl: string,
	levelsUp = 0,
): Promise<string> {
	const isDeno = typeof (globalThis as any).Deno !== "undefined";

	if (isDeno) {
		let url = new URL(importMetaUrl);
		for (let i = 0; i < levelsUp; i++) {
			url = new URL("..", url);
		}
		return url.pathname;
	}

	const { dirname, resolve, normalize } = await import(
		/* @vite-ignore */ "node:path"
	);
	const { fileURLToPath } = await import(/* @vite-ignore */ "node:url");
	let dir = normalize(dirname(fileURLToPath(importMetaUrl)));
	for (let i = 0; i < levelsUp; i++) {
		dir = resolve(dir, "..");
	}
	return dir;
}
