/**
 * createSSRApp — 创建 Hono SSR 应用
 *
 * 提供 SSR 通配路由，读取模板、加载 SSR 模块、渲染。
 * 应用层可在此之上追加自定义路由（API 代理等）。
 */

import { getLocaleAttributes } from "@finesoft/core";
import { injectCSRShell, injectSSRContent } from "@finesoft/ssr";
import { Hono } from "hono";
import type { ViteDevServer } from "vite";
import { dynamicImport } from "./dynamic-import";
import { createInternalFetch, MAX_SSR_DEPTH, SSR_DEPTH_HEADER } from "./internal-fetch";

/**
 * 匹配 Vite 配置级别的 renderMode 覆盖。
 * 精确路径优先，然后 glob 模式。
 */
function matchRenderModeOverride(url: string, renderModes?: Record<string, string>): string | null {
    if (!renderModes) return null;
    const path = url.split("?")[0];
    if (renderModes[path]) return renderModes[path];
    for (const [pattern, mode] of Object.entries(renderModes)) {
        if (pattern.includes("*")) {
            const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
            const re = new RegExp("^" + escaped.replace(/\*/g, ".*") + "$");
            if (re.test(path)) return mode;
        }
    }
    return null;
}

export interface SSRModule {
    render: (
        url: string,
        ssrContext?: {
            fetch?: typeof globalThis.fetch;
            request?: Request;
        },
    ) => Promise<{
        html: string;
        head: string;
        css: string;
        serverData: unknown;
        renderMode?: string;
        redirect?: { url: string; status: number };
        slots?: Record<string, string>;
        locale?: { lang: string; dir: string };
        i18n?: { locale: string; messages: Record<string, string> };
    }>;
    serializeServerData: (
        data: unknown,
        i18n?: { locale: string; messages: Record<string, string> },
    ) => string;
}

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
    parentFetch?: (request: Request) => Response | Promise<Response>;
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

export function createSSRApp(options: SSRAppOptions): Hono {
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

    const app = new Hono();

    /** ISR 内存缓存（prerender 路由首次请求后缓存，LRU 驱逐） */
    const ISR_CACHE_MAX = 1000;
    const isrCache = new Map<string, string>();
    function isrSet(key: string, val: string) {
        if (isrCache.size >= ISR_CACHE_MAX) {
            const first = isrCache.keys().next().value;
            if (first !== undefined) isrCache.delete(first);
        }
        isrCache.set(key, val);
    }

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

    app.get("*", async (c) => {
        // 递归深度保护：从请求头读取 SSR 深度
        const ssrDepth = parseInt(c.req.header(SSR_DEPTH_HEADER) ?? "0", 10);
        if (ssrDepth >= MAX_SSR_DEPTH) {
            return c.text("SSR recursion loop detected", 508);
        }

        const url = c.req.path + (c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "");

        try {
            const template = await readTemplate(url);
            const ssrMod = await loadSSRModule();

            if (
                typeof ssrMod.render !== "function" ||
                typeof ssrMod.serializeServerData !== "function"
            ) {
                throw new Error(
                    "[SSR] Module missing required exports: render, serializeServerData",
                );
            }

            const { render, serializeServerData } = ssrMod;

            // Vite 配置级别覆盖：CSR 直接返回空壳
            const overrideMode = matchRenderModeOverride(url, renderModes);
            if (overrideMode === "csr") {
                return c.html(
                    injectCSRShell(
                        template,
                        defaultLocale ? getLocaleAttributes(defaultLocale) : undefined,
                    ),
                );
            }

            // ISR 缓存命中
            const cached = isrCache.get(url);
            if (cached) return c.html(cached);

            // 每请求创建 internalFetch，深度通过请求头传递
            const requestFetch = parentFetch
                ? createInternalFetch(parentFetch, ssrDepth + 1)
                : undefined;

            const ssrContext: {
                fetch?: typeof globalThis.fetch;
                request?: Request;
            } = { request: c.req.raw };
            if (requestFetch) ssrContext.fetch = requestFetch;

            const {
                html: appHtml,
                head,
                css,
                serverData,
                renderMode,
                redirect: middlewareRedirect,
                slots,
                locale,
                i18n,
            } = await render(url, ssrContext);

            // 中间件要求重定向
            if (middlewareRedirect) {
                return c.redirect(middlewareRedirect.url, middlewareRedirect.status as 301 | 302);
            }

            // CSR 模式：返回空壳 HTML
            if (renderMode === "csr") {
                return c.html(injectCSRShell(template, locale));
            }

            const serializedData = serializeServerData(serverData, i18n);

            const finalHtml = injectSSRContent({
                template,
                head,
                css,
                html: appHtml,
                serializedData,
                slots,
                locale,
            });

            // Prerender ISR 缓存（包括 Vite 配置覆盖和路由级）
            if (renderMode === "prerender" || overrideMode === "prerender") {
                isrSet(url, finalHtml);
            }

            return c.html(finalHtml);
        } catch (e) {
            if (!isProduction && vite) {
                vite.ssrFixStacktrace(e as Error);
            }
            console.error("[SSR Error]", e);
            return c.text("Internal Server Error", 500);
        }
    });

    return app;
}
