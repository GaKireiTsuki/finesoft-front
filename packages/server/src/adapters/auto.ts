/**
 * Auto 适配器 — 根据环境变量自动选择目标平台
 *
 * 检测顺序：
 *   VERCEL       → vercel
 *   CF_PAGES     → cloudflare
 *   NETLIFY      → netlify
 *   (default)    → node
 */

import { resolveAdapter } from "./resolve";
import type { Adapter } from "./types";

export function autoAdapter(): Adapter {
	return {
		name: "auto",
		async build(ctx) {
			const detected = detectPlatform();
			console.log(`  [auto] Detected platform: ${detected}\n`);
			const adapter = resolveAdapter(detected);
			return adapter.build(ctx);
		},
	};
}

function detectPlatform(): string {
	if (process.env.VERCEL) return "vercel";
	if (process.env.CF_PAGES) return "cloudflare";
	if (process.env.NETLIFY) return "netlify";
	return "node";
}
