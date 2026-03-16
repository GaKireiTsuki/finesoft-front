/**
 * Vercel 适配器 — Build Output API v3
 *
 * 生成 .vercel/output/ 目录：
 * - config.json — 路由规则
 * - static/     — 静态资源
 * - functions/ssr.func/ — Serverless Function
 */

import {
	buildBundle,
	copyStaticAssets,
	generateSSREntry,
	prerenderRoutes,
} from "./shared";
import type { Adapter } from "./types";

export function vercelAdapter(): Adapter {
	return {
		name: "vercel",
		async build(ctx) {
			const { fs, path, root } = ctx;
			const outputDir = path.resolve(root, ".vercel/output");

			// 清理旧输出
			fs.rmSync(outputDir, { recursive: true, force: true });

			// 生成入口源码
			// Vercel Serverless (launcherType: "Nodejs") 传入 Node.js IncomingMessage，
			// 必须用 @hono/node-server 转换为 Web Request，而非 hono/vercel 的 handle。
			// 因为 dest 统一重写到 /ssr，req.url 会丢失原始路径，
			// 需要从 Vercel 的 x-now-route-matches 头中恢复实际请求路径。
			const entrySource = generateSSREntry(ctx, {
				platformImport: `import { getRequestListener } from "@hono/node-server";`,
				platformExport: [
					`const _listener = getRequestListener(app.fetch);`,
					`export default (req, res) => {`,
					`  const m = req.headers["x-now-route-matches"];`,
					`  if (typeof m === "string") {`,
					`    try {`,
					`      const p = new URLSearchParams(m);`,
					`      const c = p.get("1");`,
					`      if (c != null) {`,
					`        const qi = (req.url || "").indexOf("?");`,
					`        const qs = qi !== -1 ? req.url.slice(qi) : "";`,
					`        req.url = "/" + decodeURIComponent(c) + qs;`,
					`      }`,
					`    } catch {}`,
					`  }`,
					`  return _listener(req, res);`,
					`};`,
				].join("\n"),
			});

			// 写入临时入口文件
			const tempEntry = path.resolve(root, ".vercel-entry.tmp.mjs");
			fs.writeFileSync(tempEntry, entrySource);

			try {
				const funcDir = path.resolve(
					root,
					".vercel/output/functions/ssr.func",
				);

				// 构建 serverless function
				await buildBundle(ctx, {
					entry: ".vercel-entry.tmp.mjs",
					outDir: funcDir,
					target: "node18",
				});

				// .vc-config.json
				fs.writeFileSync(
					path.resolve(funcDir, ".vc-config.json"),
					JSON.stringify(
						{
							runtime: "nodejs20.x",
							handler: "index.mjs",
							launcherType: "Nodejs",
						},
						null,
						2,
					),
				);

				// 静态资源
				copyStaticAssets(
					ctx,
					path.resolve(root, ".vercel/output/static"),
				);

				// 路由配置：静态文件优先，其余全部路由到 /ssr 函数
				// Vercel 会在 x-now-route-matches 头中携带正则捕获组，
				// 入口代码据此恢复原始请求路径
				fs.writeFileSync(
					path.resolve(root, ".vercel/output/config.json"),
					JSON.stringify(
						{
							version: 3,
							routes: [
								{ handle: "filesystem" },
								{ src: "/(.*)", dest: "/ssr" },
							],
						},
						null,
						2,
					),
				);
			} finally {
				fs.rmSync(tempEntry, { force: true });
			}
			// 构建时预渲染 prerender 路由
			const prerendered = await prerenderRoutes(ctx);
			const staticDir = path.resolve(root, ".vercel/output/static");
			for (const { url, html } of prerendered) {
				const filePath =
					url === "/"
						? path.join(staticDir, "index.html")
						: path.join(staticDir, url, "index.html");
				fs.mkdirSync(path.resolve(filePath, ".."), { recursive: true });
				fs.writeFileSync(filePath, html);
			}

			// 为预渲染路由写入 Vercel ISR 配置（overrides）
			if (prerendered.length > 0) {
				const configPath = path.resolve(
					root,
					".vercel/output/config.json",
				);
				const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
				config.overrides = config.overrides ?? {};
				for (const { url } of prerendered) {
					const key =
						url === "/"
							? "index.html"
							: `${url.replace(/^\//, "")}/index.html`;
					config.overrides[key] = {
						path: url === "/" ? "/" : url,
						contentType: "text/html; charset=utf-8",
					};
				}
				fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
			}

			console.log("  Vercel output → .vercel/output/\n");
		},
	};
}
