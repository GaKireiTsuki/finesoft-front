import { nodeDnsLookup } from "./node/dns";
/**
 * createSSRApp — 创建 Hono SSR 应用
 *
 * 提供 SSR 通配路由，读取模板、加载 SSR 模块、渲染。
 * 应用层可在此之上追加自定义路由（API 代理等）。
 */

import { Hono } from "hono";
import type { ViteDevServer } from "vite";
import { dynamicImport } from "./dynamic-import";

export type { SSRModule } from "./ssr-handler";
import { createSSRHandler, type SSRModule } from "./ssr-handler";

export interface SSRAppOptions {
    /** 项目根路径 */
    root: string;
    /** Vite dev server（仅开发模式） */
    vite?: ViteDevServer;
    /** 是否生产环境 */
    isProduction: boolean;
    /** SSR 入口文件路径（开发用，如 "/src/ssr.ts"） */
    ssrEntryPath?: string;
    /** 生产环境 SSR 模块路径（如 "../dist/server/ssr.js"） */
    ssrProductionModule?: string;
    /**
     * 父级 Hono app 的 fetch 函数，用于 SSR 内部路由回环。
     * SSR 渲染时，控制器的 fetch 请求（如 /api/apple/*）会通过此函数
     * 直接在进程内路由到代理 handler，避免网络自请求死锁。
     */
    parentFetch?: (
        request: Request,
        bindings?: Readonly<Record<string, unknown>>,
    ) => Response | Promise<Response>;
    /**
     * 按路由覆盖渲染模式（精确路径或 glob 模式）。
     * 优先级高于路由级 renderMode。
     */
    renderModes?: Record<string, string>;
    /**
     * 默认 locale（如 "zh-Hans"、"en-US"）。
     * 用于 CSR 早退场景（配置级 renderMode=csr，未调用 render）将 lang/dir 注入 `<html>` 属性。
     */
    defaultLocale?: string;
}

export function createSSRApp(options: SSRAppOptions): Hono<{ Bindings: Record<string, unknown> }> {
    const {
        root,
        vite,
        isProduction,
        ssrEntryPath = "/src/ssr.ts",
        ssrProductionModule,
        parentFetch,
        renderModes,
        defaultLocale,
    } = options;

    const app = new Hono<{ Bindings: Record<string, unknown> }>();

    /** 生产环境模板缓存（模板不变，避免每请求重复读盘） */
    let templateCache: string | undefined;

    async function readTemplate(url: string): Promise<string> {
        if (!isProduction && vite) {
            const { readFileSync } = await dynamicImport("node:fs");
            const path = await dynamicImport("node:path");
            const raw = readFileSync(path.resolve(root, "index.html"), "utf-8");
            return vite.transformIndexHtml(url, raw);
        }

        if (templateCache) return templateCache;

        const isDeno = typeof (globalThis as any).Deno !== "undefined";
        if (isDeno) {
            // The relative path is resolved at runtime on Deno only.
            // Construct via string concatenation to avoid Vite's static
            // `new URL(..., import.meta.url)` analysis at build time.
            const base = import.meta.url;
            templateCache = (globalThis as any).Deno.readTextFileSync(
                new URL("../dist/client/index.html", base),
            );
            return templateCache!;
        }

        const { readFileSync } = await dynamicImport("node:fs");
        const path = await dynamicImport("node:path");
        templateCache = readFileSync(path.resolve(root, "dist/client/index.html"), "utf-8");
        return templateCache!;
    }

    async function loadSSRModule(): Promise<SSRModule> {
        if (!isProduction && vite) {
            return (await vite.ssrLoadModule(ssrEntryPath)) as SSRModule;
        }
        if (ssrProductionModule) {
            return dynamicImport(ssrProductionModule) as Promise<SSRModule>;
        }
        const path = await dynamicImport("node:path");
        const { pathToFileURL } = await dynamicImport("node:url");
        const absPath = pathToFileURL(path.resolve(root, "dist/server/ssr.js")).href;
        return dynamicImport(absPath) as Promise<SSRModule>;
    }

    const handler = createSSRHandler({
        template: (request) =>
            readTemplate(new URL(request.url).pathname + new URL(request.url).search),
        loadModule: () => loadSSRModule(),
        renderModes,
        defaultLocale,
        fetch: parentFetch,
        safeFetch: { lookup: nodeDnsLookup },
        onError: (error) => {
            if (!isProduction && vite) vite.ssrFixStacktrace(error as Error);
            console.error("[SSR Error]", error);
        },
    });
    app.get("*", (c) => handler(c.req.raw, c.env));
    return app;
}
