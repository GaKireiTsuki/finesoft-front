/**
 * Node 适配器 — 独立 HTTP 服务器
 *
 * 生成 dist/server/index.mjs，使用 @hono/node-server 监听端口。
 * 运行：node dist/server/index.mjs
 */

import { buildBundle, generateSSREntry, prerenderRoutes } from "./shared";
import type { Adapter } from "./types";

export function nodeAdapter(): Adapter {
	return {
		name: "node",
		async build(ctx) {
			const { fs, path, root } = ctx;

			const entrySource = generateSSREntry(ctx, {
				platformImport: `import { serve } from "@hono/node-server";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";`,
				platformMiddleware: `
// 预渲染文件中间件：检查 dist/prerender/ 下是否有对应的静态 HTML
const __entry_dirname = dirname(fileURLToPath(import.meta.url));
const prerenderDir = resolve(__entry_dirname, "../prerender");

app.use("*", async (c, next) => {
  const urlPath = c.req.path;
  const candidates = [
    resolve(prerenderDir, "." + urlPath, "index.html"),
    resolve(prerenderDir, "." + urlPath + ".html"),
  ];
  if (urlPath === "/") candidates.unshift(resolve(prerenderDir, "index.html"));
  for (const f of candidates) {
    if (existsSync(f)) {
      const html = readFileSync(f, "utf-8");
      return c.html(html);
    }
  }
  await next();
});
`,
				platformExport: `
const port = +(process.env.PORT || 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(\`Server running at http://localhost:\${info.port}\`);
});
`,
			});

			const tempEntry = path.resolve(root, ".node-entry.tmp.mjs");
			fs.writeFileSync(tempEntry, entrySource);

			try {
				await buildBundle(ctx, {
					entry: ".node-entry.tmp.mjs",
					outDir: path.resolve(root, "dist/server"),
					target: "node18",
				});
			} finally {
				fs.rmSync(tempEntry, { force: true });
			}

			// 构建时预渲染 prerender 路由
			const prerendered = await prerenderRoutes(ctx);
			if (prerendered.length > 0) {
				const prerenderDir = path.resolve(root, "dist/prerender");
				fs.mkdirSync(prerenderDir, { recursive: true });
				for (const { url, html } of prerendered) {
					const filePath =
						url === "/"
							? path.join(prerenderDir, "index.html")
							: path.join(prerenderDir, url, "index.html");
					fs.mkdirSync(path.resolve(filePath, ".."), {
						recursive: true,
					});
					fs.writeFileSync(filePath, html);
				}
			}

			console.log(
				"  Node output → dist/server/index.mjs\n" +
					"  Run: node dist/server/index.mjs\n",
			);
		},
	};
}
