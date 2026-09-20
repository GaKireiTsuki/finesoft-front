/**
 * Netlify 适配器 — Netlify Functions v2
 *
 * 生成：
 * - .netlify/functions-internal/ssr/index.mjs — Serverless Function
 * - dist/client/_redirects — 路由重写规则
 */

import {
    buildGeneratedEntry,
    generateSSREntry,
    prerenderRoutes,
    writePrerenderedPages,
} from "./shared";
import type { Adapter } from "./types";

export function netlifyAdapter(): Adapter {
    return {
        name: "netlify",
        async build(ctx) {
            const { fs, path, root } = ctx;
            const funcDir = path.resolve(root, ".netlify/functions-internal/ssr");

            fs.rmSync(path.resolve(root, ".netlify"), {
                recursive: true,
                force: true,
            });

            const entrySource = generateSSREntry(ctx, {
                platformImport: `import { handle } from "hono/netlify";`,
                platformExport: `export default handle(app);
export const config = { path: "/*", preferStatic: true };`,
                // Netlify CDN 缓存 — 使用 Netlify-CDN-Cache-Control 头做 ISR
                platformCache: `
const ISR_SWR_TTL = 3600;
const ISR_CACHE_MAX = 1000;
const _isrMap = new Map();
async function platformCacheGet(url) {
  return _isrMap.get(url) ?? null;
}
async function platformCacheSet(url, html) {
  if (_isrMap.size >= ISR_CACHE_MAX) {
    const first = _isrMap.keys().next().value;
    _isrMap.delete(first);
  }
  _isrMap.set(url, html);
}`,
                publicCacheHeaders: {
                    "Netlify-CDN-Cache-Control":
                        "public, max-age=3600, stale-while-revalidate=86400",
                },
            });

            await buildGeneratedEntry(ctx, ".netlify-entry.tmp.mjs", entrySource, {
                outDir: funcDir,
                target: "node18",
            });

            // _redirects — 静态文件优先，其余走 SSR function
            const redirects = `/* /.netlify/functions/ssr 200\n`;
            fs.writeFileSync(path.resolve(root, "dist/client/_redirects"), redirects);

            // 构建时预渲染
            writePrerenderedPages(
                ctx,
                path.resolve(root, "dist/client"),
                await prerenderRoutes(ctx),
            );

            console.log(
                "  Netlify output → .netlify/functions-internal/ssr/\n" +
                    "  Publish dir: dist/client/\n",
            );
        },
    };
}
