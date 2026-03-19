/**
 * finesoftFrontViteConfig — Vite 插件
 *
 * 将 Hono SSR 服务器集成到 Vite 的 dev / build / preview 生命周期中，
 * 使 template-project 只需 `vite` / `vite build` / `vite preview` 即可运行。
 *
 * 支持多平台 adapter: "vercel" | "cloudflare" | "netlify" | "node" | "static" | "auto"
 * 或自定义 Adapter 对象。
 */

import { getLocaleAttributes } from "@finesoft/core";
import { injectCSRShell, injectSSRContent } from "@finesoft/ssr";
import type { Hono } from "hono";
import { resolveAdapter } from "./adapters/resolve";
import { buildBundle, copyStaticAssets, generateSSREntry, NODE_BUILTINS } from "./adapters/shared";
import type { Adapter } from "./adapters/types";
import { createSSRApp, type SSRModule } from "./app";
import { dynamicImport } from "./dynamic-import";
import { createInternalFetch, MAX_SSR_DEPTH, SSR_DEPTH_HEADER } from "./internal-fetch";
import { registerProxyRoutes, type ProxyRouteConfig } from "./proxy";

export interface FinesoftFrontViteOptions {
    /** SSR 配置 */
    ssr?: {
        /** SSR 入口文件路径（默认 "src/ssr.ts"） */
        entry?: string;
    };
    /**
     * 声明式代理路由配置。
     * 框架统一执行路径校验（SSRF 防护）、Host 限制、错误处理、响应头控制。
     * 代理路由在 setup 之前注册，优先级高于自定义路由。
     */
    proxies?: ProxyRouteConfig[];
    /**
     * 注册自定义路由（非代理类）。
     * - 传入 Function：仅 dev/preview 时可用。
     * - 传入 string（文件路径）：dev/preview/adapter 均可用，
     *   文件需 export default 一个 (app: Hono) => void 函数。
     * 注意：代理路由请使用 proxies 选项，不要在 setup 中手写代理。
     */
    setup?: ((app: Hono) => void | Promise<void>) | string;
    /**
     * 部署适配器。
     * - 字符串快捷方式："vercel" | "cloudflare" | "netlify" | "node" | "static" | "auto"
     * - 自定义 Adapter 对象：{ name, build(ctx) }
     * - 不设置则不生成部署产物
     */
    adapter?: string | Adapter;
    /**
     * 按路由覆盖渲染模式（优先级高于 RouteDefinition.renderMode）。
     * key: 精确路径或 glob 模式，如 "/search" 或 "/blog/*"
     * value: "ssr" | "csr" | "prerender"
     *
     * @example
     * ```ts
     * renderModes: {
     *   "/search": "csr",
     *   "/blog/*": "prerender",
     * }
     * ```
     */
    renderModes?: Record<string, "ssr" | "csr" | "prerender">;
    /**
     * 路由定义入口文件（用于预渲染时加载路由），默认 "src/lib/bootstrap.ts"。
     * 如果项目不使用声明式路由定义，可以不设置。
     */
    bootstrapEntry?: string;
    /**
     * 默认 locale（如 "zh-Hans"、"en-US"）。
     * 用于 CSR 壳注入 `<html lang="" dir="">`，以及预渲染时的默认语言。
     */
    defaultLocale?: string;
    /**
     * 预渲染支持的语言列表。
     * 提供后，每个 prerender 路由会与每个 locale 组合生成 `/:locale/path` 版本。
     * `defaultLocale` 的路由同时输出无前缀版本。
     */
    locales?: string[];
}

/**
 * 从 setup 模块中查找 setup 函数：优先 default，其次 setup 命名导出。
 */
function resolveSetupFn(mod: Record<string, unknown>): ((app: any) => void | Promise<void>) | null {
    if (typeof mod.default === "function") return mod.default as any;
    if (typeof mod.setup === "function") return mod.setup as any;
    const first = Object.values(mod).find((v) => typeof v === "function");
    return (first as any) ?? null;
}

/**
 * 匹配 Vite 配置级别的 renderMode 覆盖。
 * 精确路径优先，然后 glob 模式。
 */
function matchRenderModeConfig(url: string, renderModes?: Record<string, string>): string | null {
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

export function finesoftFrontViteConfig(options: FinesoftFrontViteOptions = {}) {
    const ssrEntry = options.ssr?.entry ?? "src/ssr.ts";
    let root = process.cwd();
    let resolvedCommand: string | undefined;
    let resolvedResolve: unknown;
    let resolvedCss: unknown;

    const CSS_EXTENSIONS = /\.(css|scss|less|sass|styl|stylus|pcss|postcss)($|\?)/;

    return {
        name: "finesoft-front",

        config(userConfig: Record<string, any>) {
            const overrides: Record<string, any> = {
                appType: "custom",
            };
            if (!process.env.__FINESOFT_SUB_BUILD__) {
                overrides.build = {
                    outDir: userConfig.build?.outDir ?? "dist/client",
                };
            }
            return overrides;
        },

        configResolved(config: Record<string, any>) {
            resolvedCommand = config.command as string;
            resolvedResolve = config.resolve;
            resolvedCss = config.css;
            root = config.root as string;
        },

        /**
         * Dev 模式 CSS 内联 — 消除 SSR 首屏布局抖动
         *
         * Vite dev 模式下，global.scss 等非组件 CSS 通过 JS 模块系统异步加载，
         * 导致 SSR HTML 初次渲染缺少布局关键样式（box-sizing、flex 布局、padding-top 等）。
         *
         * 此 hook 在 HTML 模板变换阶段（SSR 渲染之前）：
         * 1. 找到浏览器入口脚本（排除 /@vite/client 等内部脚本）
         * 2. 编译入口脚本，填充 Vite 模块图
         * 3. 遍历模块图收集所有 CSS 依赖（排除 .svelte 组件 CSS，由 SSR 渲染自行处理）
         * 4. 通过 ssrLoadModule 获取编译后 CSS（SCSS→CSS）
         * 5. 注入 <style data-vite-dev-id> 标签到 <head>
         *
         * data-vite-dev-id 确保 Vite HMR 客户端复用已有标签，避免重复注入。
         */
        transformIndexHtml: {
            order: "pre" as const,
            async handler(html: string, ctx: any) {
                const server = ctx.server;
                if (!server) return;

                // 跳过非页面 URL（如 .json / .xml 等资源路径）。
                // Vite 会以页面 URL 为前缀生成虚拟模块 ID，
                // 含 .json 的路径会触发 vite:json 插件误解析 CSS。
                const urlPath = (ctx.originalUrl || ctx.path || "").split("?")[0];
                if (/\.\w+$/.test(urlPath) && !urlPath.endsWith(".html")) {
                    return;
                }

                // 找到浏览器入口脚本（排除 Vite 内部 /@... 路径）
                const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)];
                const appEntry = scripts.find((m) => !m[1].startsWith("/@"));
                if (!appEntry) return;

                const browserEntry = appEntry[1];

                // 编译浏览器入口，填充模块图
                try {
                    await server.transformRequest(browserEntry);
                } catch {
                    return;
                }

                // 从模块图遍历 CSS 依赖
                const cssUrls: string[] = [];
                const visited = new Set<string>();

                function walk(mod: any, depth = 0): void {
                    if (depth > 100) return;
                    if (!mod?.url || visited.has(mod.url)) return;
                    visited.add(mod.url);
                    // 收集 CSS，但排除 .svelte 组件 CSS（由 SSR 渲染处理）
                    if (CSS_EXTENSIONS.test(mod.url) && !mod.url.includes(".svelte")) {
                        cssUrls.push(mod.url);
                    }
                    if (mod.importedModules) {
                        for (const imported of mod.importedModules) {
                            walk(imported, depth + 1);
                        }
                    }
                }

                const mg = server.moduleGraph;
                const browserMod = await mg.getModuleByUrl(browserEntry);
                if (browserMod) walk(browserMod);

                if (cssUrls.length === 0) return;

                // 通过 ssrLoadModule 获取编译后 CSS，注入为 <style> 标签
                const tags: Array<{
                    tag: string;
                    attrs: Record<string, string>;
                    children: string;
                    injectTo: "head";
                }> = [];

                for (const url of cssUrls) {
                    try {
                        const mod: any = await server.ssrLoadModule(url);
                        const css = mod?.default;
                        if (typeof css === "string" && css.length > 0) {
                            tags.push({
                                tag: "style",
                                attrs: { "data-vite-dev-id": url },
                                children: css,
                                injectTo: "head",
                            });
                        }
                    } catch {
                        /* CSS 编译失败则跳过 */
                    }
                }

                return tags;
            },
        },

        // ─── Dev ───────────────────────────────────────────────
        configureServer(server: any) {
            return async () => {
                const { Hono: HonoClass } = await dynamicImport("hono");
                const { getRequestListener } = await dynamicImport("@hono/node-server");

                const app = new HonoClass();

                // 声明式代理路由（框架层，优先注册）
                if (options.proxies?.length) {
                    registerProxyRoutes(app, options.proxies);
                }

                // Setup: 函数直接调用，文件路径通过 ssrLoadModule 加载
                if (typeof options.setup === "function") {
                    await options.setup(app);
                } else if (typeof options.setup === "string") {
                    const mod = await server.ssrLoadModule("/" + options.setup);
                    const fn = resolveSetupFn(mod);
                    if (fn) await fn(app);
                }

                const ssrApp = createSSRApp({
                    root,
                    vite: server,
                    isProduction: false,
                    ssrEntryPath: "/" + ssrEntry,
                    parentFetch: app.fetch.bind(app),
                    renderModes: options.renderModes,
                    defaultLocale: options.defaultLocale,
                });
                app.route("/", ssrApp);

                const listener = getRequestListener(app.fetch);

                server.middlewares.use((req: any, res: any) => {
                    void listener(req, res);
                });
            };
        },

        // ─── Preview ───────────────────────────────────────────
        configurePreviewServer(server: any) {
            return async () => {
                const { readFileSync } = await dynamicImport("node:fs");
                const path = await dynamicImport("node:path");
                const { pathToFileURL } = await dynamicImport("node:url");
                const { Hono: HonoClass } = await dynamicImport("hono");
                const { getRequestListener } = await dynamicImport("@hono/node-server");

                const app = new HonoClass();

                // ISR 内存缓存（有容量上限）
                const ISR_CACHE_MAX = 1000;
                const isrCache = new Map<string, string>();
                function isrSet(key: string, val: string) {
                    if (isrCache.size >= ISR_CACHE_MAX) {
                        const first = isrCache.keys().next().value;
                        if (first !== undefined) isrCache.delete(first);
                    }
                    isrCache.set(key, val);
                }

                // 声明式代理路由（框架层，优先注册）
                if (options.proxies?.length) {
                    registerProxyRoutes(app, options.proxies);
                }

                // Setup: 函数直接调用，文件路径从构建产物加载
                if (typeof options.setup === "function") {
                    await options.setup(app);
                } else if (typeof options.setup === "string") {
                    try {
                        const setupPath = pathToFileURL(
                            path.resolve(root, "dist/server/setup.mjs"),
                        ).href;
                        const mod = await dynamicImport(setupPath);
                        const fn = resolveSetupFn(mod as Record<string, unknown>);
                        if (fn) await fn(app);
                    } catch {
                        console.warn(
                            "[finesoft] Could not load setup module for preview. API routes disabled.",
                        );
                    }
                }

                const templatePath = path.resolve(root, "dist/client/index.html");
                const template = readFileSync(templatePath, "utf-8");

                const ssrPath = pathToFileURL(path.resolve(root, "dist/server/ssr.js")).href;
                const ssrModule = (await dynamicImport(ssrPath)) as SSRModule;

                app.get("*", async (c: any) => {
                    // 递归深度保护
                    const ssrDepth = parseInt(c.req.header(SSR_DEPTH_HEADER) ?? "0", 10);
                    if (ssrDepth >= MAX_SSR_DEPTH) {
                        return c.text("SSR recursion loop detected", 508);
                    }

                    const url =
                        c.req.path + (c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "");

                    try {
                        // Vite 配置级别覆盖
                        const overrideMode = matchRenderModeConfig(url, options.renderModes);
                        if (overrideMode === "csr") {
                            return c.html(
                                injectCSRShell(
                                    template,
                                    options.defaultLocale
                                        ? getLocaleAttributes(options.defaultLocale)
                                        : undefined,
                                ),
                            );
                        }

                        // ISR 缓存命中
                        const cached = isrCache.get(url);
                        if (cached) return c.html(cached);

                        const {
                            html: appHtml,
                            head,
                            css,
                            serverData,
                            renderMode,
                            locale,
                            i18n,
                        } = await ssrModule.render(url, {
                            fetch: createInternalFetch(app.fetch.bind(app), ssrDepth + 1),
                        });

                        // 路由级 CSR
                        if (renderMode === "csr") {
                            return c.html(injectCSRShell(template, locale));
                        }

                        const serializedData = ssrModule.serializeServerData(serverData, i18n);

                        const finalHtml = injectSSRContent({
                            template,
                            head,
                            css,
                            html: appHtml,
                            serializedData,
                            locale,
                        });

                        // Prerender ISR 缓存
                        if (renderMode === "prerender" || overrideMode === "prerender") {
                            isrSet(url, finalHtml);
                        }

                        return c.html(finalHtml);
                    } catch (e) {
                        console.error("[SSR Preview Error]", e);
                        return c.text("Internal Server Error", 500);
                    }
                });

                const listener = getRequestListener(app.fetch);

                server.middlewares.use((req: any, res: any) => {
                    void listener(req, res);
                });
            };
        },

        // ─── Build ─────────────────────────────────────────────
        async closeBundle() {
            if (process.env.__FINESOFT_SUB_BUILD__) return;
            if (resolvedCommand !== "build") return;

            process.env.__FINESOFT_SUB_BUILD__ = "1";
            try {
                const vite: any = await dynamicImport("vite");
                const fs = await dynamicImport("node:fs");
                const path = await dynamicImport("node:path");

                // ── 1. SSR 构建 ──
                console.log("\n  Building SSR bundle...\n");
                await vite.build({
                    root,
                    build: {
                        ssr: ssrEntry,
                        outDir: "dist/server",
                    },
                    ssr: {
                        external: NODE_BUILTINS,
                    },
                    resolve: resolvedResolve,
                    css: resolvedCss,
                });

                // ── 2. Setup 模块构建（仅当 setup 是文件路径时） ──
                if (typeof options.setup === "string") {
                    console.log("  Building setup module...\n");
                    await vite.build({
                        root,
                        build: {
                            ssr: options.setup,
                            outDir: "dist/server",
                            emptyOutDir: false,
                            rollupOptions: {
                                output: { entryFileNames: "setup.mjs" },
                            },
                        },
                        resolve: resolvedResolve,
                    });
                }

                // ── 3. Adapter 构建 ──
                if (options.adapter) {
                    const adapter = resolveAdapter(options.adapter);

                    const templateHtml = fs.readFileSync(
                        path.resolve(root, "dist/client/index.html"),
                        "utf-8",
                    );

                    const ctx = {
                        root,
                        ssrEntry,
                        setupPath: typeof options.setup === "string" ? options.setup : undefined,
                        bootstrapEntry: options.bootstrapEntry,
                        templateHtml,
                        renderModes: options.renderModes,
                        proxies: options.proxies,
                        locales: options.locales,
                        defaultLocale: options.defaultLocale,
                        resolvedResolve,
                        resolvedCss,
                        vite,
                        fs,
                        path,
                        generateSSREntry(opts: any) {
                            return generateSSREntry(ctx, opts);
                        },
                        buildBundle(opts: any) {
                            return buildBundle(ctx, opts);
                        },
                        copyStaticAssets(destDir: string, opts?: any) {
                            return copyStaticAssets(ctx, destDir, opts);
                        },
                    };

                    console.log(`  Running adapter: ${adapter.name}...\n`);
                    await adapter.build(ctx);
                }
            } finally {
                delete process.env.__FINESOFT_SUB_BUILD__;
            }
        },
    };
}
