/**
 * Cloudflare Pages 适配器
 *
 * 生成 dist/cloudflare/ 目录：
 * - _worker.js — Workers 入口（Hono 原生支持 CF fetch 接口）
 * - assets/    — 静态资源
 *
 * 注意：Cloudflare Workers 不支持原生 Node.js API。
 * 若 setup 代理使用了 process.env，需在 wrangler.toml 启用 nodejs_compat。
 */

import {
	buildBundle,
	copyStaticAssets,
	generateSSREntry,
	prerenderRoutes,
} from "./shared";
import type { Adapter } from "./types";

export function cloudflareAdapter(): Adapter {
	return {
		name: "cloudflare",
		async build(ctx) {
			const { fs, path, root } = ctx;
			const outputDir = path.resolve(root, "dist/cloudflare");

			fs.rmSync(outputDir, { recursive: true, force: true });

			// Hono 原生支持 CF Workers 的 fetch 接口，直接 export default app
			const entrySource = generateSSREntry(ctx, {
				platformImport: ``,
				platformExport: `export default app;`,
				// Cloudflare Cache API — 持久化 ISR 缓存到 CDN 边缘节点
				platformCache: `
const ISR_CACHE_TTL = 3600; // 1 hour
async function platformCacheGet(url) {
  try {
    const cache = caches.default;
    const cacheKey = new Request("https://isr-cache/" + encodeURIComponent(url));
    const resp = await cache.match(cacheKey);
    if (resp) return await resp.text();
  } catch {}
  return null;
}
async function platformCacheSet(url, html) {
  try {
    const cache = caches.default;
    const cacheKey = new Request("https://isr-cache/" + encodeURIComponent(url));
    const resp = new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=" + ISR_CACHE_TTL },
    });
    await cache.put(cacheKey, resp);
  } catch {}
}`,
			});

			const tempEntry = path.resolve(root, ".cf-entry.tmp.mjs");
			fs.writeFileSync(tempEntry, entrySource);

			try {
				await buildBundle(ctx, {
					entry: ".cf-entry.tmp.mjs",
					outDir: outputDir,
					target: "es2022",
					fileName: "_worker.js",
					// 使用默认 external（vite/esbuild/rollup/fsevents/lightningcss）
					// 这些构建工具运行时不需要，且 fsevents 是 macOS .node 原生二进制无法打包
				});

				// 静态资源
				copyStaticAssets(ctx, path.resolve(outputDir, "assets"));

				// 构建时预渲染
				const prerendered = await prerenderRoutes(ctx);
				for (const { url, html } of prerendered) {
					const filePath =
						url === "/"
							? path.join(outputDir, "assets", "index.html")
							: path.join(outputDir, "assets", url, "index.html");
					fs.mkdirSync(path.resolve(filePath, ".."), {
						recursive: true,
					});
					fs.writeFileSync(filePath, html);
				}
			} finally {
				fs.rmSync(tempEntry, { force: true });
			}

			console.log("  Cloudflare output → dist/cloudflare/\n");
		},
	};
}
