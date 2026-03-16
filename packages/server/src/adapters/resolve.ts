/**
 * resolveAdapter — 字符串 → Adapter 映射
 */

import { autoAdapter } from "./auto";
import { cloudflareAdapter } from "./cloudflare";
import { netlifyAdapter } from "./netlify";
import { nodeAdapter } from "./node";
import { staticAdapter } from "./static";
import type { Adapter } from "./types";
import { vercelAdapter } from "./vercel";

export function resolveAdapter(value: string | Adapter): Adapter {
	if (typeof value !== "string") return value;

	switch (value) {
		case "vercel":
			return vercelAdapter();
		case "cloudflare":
			return cloudflareAdapter();
		case "netlify":
			return netlifyAdapter();
		case "node":
			return nodeAdapter();
		case "static":
			return staticAdapter();
		case "auto":
			return autoAdapter();
		default:
			throw new Error(
				`[finesoft] Unknown adapter: "${value}". ` +
					`Available: vercel, cloudflare, netlify, node, static, auto`,
			);
	}
}
