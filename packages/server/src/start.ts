/**
 * startServer — 多运行时自动启动
 *
 * 支持 Node.js (dev HMR + prod)、Deno、Bun、Vercel。
 */

import { Hono } from "hono";
import type { ViteDevServer } from "vite";
import { dynamicImport } from "./dynamic-import";
import { detectRuntime, type RuntimeInfo } from "./runtime";

export interface StartServerOptions {
    /** 最终的 Hono app（已包含 SSR + 自定义路由） */
    app: Hono;
    /** 项目根路径 */
    root: string;
    /** 端口号 */
    port?: number;
    /** 是否生产环境 */
    isProduction: boolean;
    /** Vite dev server（仅开发模式传入） */
    vite?: ViteDevServer;
    /** 运行时信息（可选，不传时自动检测） */
    runtime?: RuntimeInfo;
    /** 已注册的路由列表（用于启动日志） */
    routes?: string[];
    /** SSR 入口路径（用于启动日志） */
    ssrEntryPath?: string;
}

export async function startServer(options: StartServerOptions): Promise<{ vite?: ViteDevServer }> {
    const { app, root, port = 3000, isProduction, vite, routes, ssrEntryPath } = options;

    const { isDeno, isBun, isVercel } = options.runtime ?? detectRuntime();

    function printStartupBanner() {
        const lines: string[] = [`\n  Server running at http://localhost:${port}\n`];
        if (routes && routes.length > 0) {
            lines.push("  Routes:");
            for (const r of routes) {
                lines.push(`    ${r}`);
            }
            lines.push("");
        }
        if (ssrEntryPath) {
            lines.push(`  SSR Entry: ${ssrEntryPath}`);
        }
        if (ssrEntryPath) {
            lines.push("");
        }
        console.log(lines.join("\n"));
    }

    if (isVercel) {
        return { vite };
    }

    if (!isProduction) {
        let devVite = vite;
        if (!devVite) {
            const { createServer: createViteServer } = await dynamicImport("vite");
            devVite = await createViteServer({
                root,
                server: { middlewareMode: true },
                appType: "custom",
            });
        }

        const { getRequestListener } = await dynamicImport("@hono/node-server");
        const { createServer } = await dynamicImport("node:http");
        const listener = getRequestListener(app.fetch);
        const server = createServer((req: any, res: any) => {
            devVite!.middlewares(req, res, () => listener(req, res));
        });
        server.listen(port, () => {
            printStartupBanner();
        });
        return { vite: devVite };
    }

    if (isDeno) {
        (globalThis as any).Deno.serve({ port }, app.fetch);
    } else if (isBun) {
        // Bun uses export default
    } else {
        // Node.js production
        const { serveStatic } = await dynamicImport("@hono/node-server/serve-static");
        const path = await dynamicImport("node:path");
        const prodApp = new Hono();
        const clientDir = path.resolve(root, "dist/client");
        prodApp.use(
            "/*",
            serveStatic({
                root: clientDir,
                // 禁止目录路径自动提供 index.html，让其 fall through 到 SSR
                rewriteRequestPath: (path: string) =>
                    path.endsWith("/") ? "/__nosuchfile__" : path,
            }),
        );
        prodApp.route("/", app);

        const { serve } = await dynamicImport("@hono/node-server");
        serve({ fetch: prodApp.fetch, port }, () => {
            printStartupBanner();
        });
    }

    return { vite };
}
