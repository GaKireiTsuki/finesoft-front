import { createSSRHandler } from "./ssr-handler";
import { createRequire } from "node:module";
import path from "node:path";
/**
 * finesoftFrontViteConfig — Vite 插件
 *
 * 将 Hono SSR 服务器集成到 Vite 的 dev / build / preview 生命周期中，
 * 使 template-project 只需 `vite` / `vite build` / `vite preview` 即可运行。
 *
 * 支持多平台 adapter: "vercel" | "cloudflare" | "netlify" | "node" | "static" | "auto"
 * 或自定义 Adapter 对象。
 */

import { nodeSafeFetchOptions } from "./node/fetch-policy";
import type { Hono } from "hono";
import { resolveAdapter } from "./adapters/resolve";
import { buildBundle, copyStaticAssets, generateSSREntry, NODE_BUILTINS } from "./adapters/shared";
import type { Adapter } from "./adapters/types";
import { createSSRApp, type SSRModule } from "./app";
import { dynamicImport } from "./dynamic-import";
import { registerProxyRoutes, type ProxyRouteConfig } from "./proxy";
import { serverControllerModules } from "./server-controller-plugin";
import { nativeBindings } from "./native-bindings";
import { generateFrontTypes } from "./public-types";
import {
    createControllerTypeWatcher,
    generateControllerTypes,
    type ControllerTypeOptions,
} from "./controller-types";

const GENERATED_I18N_LOADER_ID = "virtual:finesoft-front/i18n-loader";
const RESOLVED_GENERATED_I18N_LOADER_ID = `\0${GENERATED_I18N_LOADER_ID}`;

export interface FinesoftFrontViteOptions {
    /** Maintain route-derived class parameter types. Enabled by default for TypeScript apps. */
    controllerTypes?: ControllerTypeOptions | false;
    /** Optional reproducible build identity; otherwise generated for each paired build. */
    buildId?: string;
    /** SSR 配置 */
    ssr?: {
        /** SSR 入口文件路径（默认 "src/ssr.ts"） */
        entry?: string;
    };
    /**
     * 声明式代理路由配置。
     * 框架统一执行路径校验（SSRF 防护）、Host 限制、错误处理、响应头控制。
     * 代理路由在 setup 之后注册，受 setup 中先注册的鉴权中间件保护。
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
    /**
     * i18n JSON 字典目录。
     * 文件名必须与 locale 一致，例如 `en-US.json`、`zh-Hans.json`。
     * 配置后，框架会自动为 SSR / CSR 生成共享的消息加载器。
     */
    i18n?: {
        messagesDir: string;
    };
}

/**
 * 匹配 Vite 配置级别的 renderMode 覆盖。
 * 精确路径优先，然后 glob 模式。
 */

function normalizePathForGlob(pathname: string): string {
    return pathname.replace(/\\/g, "/");
}

let devSafetyBannerPrinted = false;

/**
 * 在 dev 启动时打印一次安全提示：dev 模式会通过 `/src/*` 和 `/@fs/*` 暴露源码（HMR
 * 必需），切勿对公网开放。Vite preview / `vp build` 产物不受影响。
 */
function printDevSafetyBanner(): void {
    if (devSafetyBannerPrinted) return;
    devSafetyBannerPrinted = true;
    const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
    const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
    console.log(
        `\n${yellow("[finesoft]")} dev server is exposing source via /src/* and /@fs/* (HMR).\n` +
            dim(
                "           Do NOT expose this server to untrusted networks; run `vp build && vp preview` for production.\n",
            ),
    );
}

async function resolveMessagesDir(root: string, messagesDir: string): Promise<string> {
    const { existsSync } = await dynamicImport("node:fs");
    const path = await dynamicImport("node:path");
    const absoluteDir = path.isAbsolute(messagesDir)
        ? messagesDir
        : path.resolve(root, messagesDir);
    if (!existsSync(absoluteDir)) {
        throw new Error(`[finesoftFrontViteConfig] i18n.messagesDir not found: ${messagesDir}`);
    }

    const relativeDir = normalizePathForGlob(path.relative(root, absoluteDir));
    if (!relativeDir || relativeDir.startsWith("..")) {
        throw new Error(
            `[finesoftFrontViteConfig] i18n.messagesDir must stay inside the project root: ${messagesDir}`,
        );
    }

    return relativeDir.replace(/^\.\/+/, "");
}

export function finesoftFrontViteConfig(options: FinesoftFrontViteOptions = {}) {
    if (!process.env.__FINESOFT_SUB_BUILD__) generateFrontTypes(options.controllerTypes || {});
    if (options.controllerTypes !== false && !process.env.__FINESOFT_SUB_BUILD__)
        generateControllerTypes(options.controllerTypes);
    const ssrEntry = options.ssr?.entry ?? "src/ssr.ts";
    let root = process.cwd();
    const serverControllers = serverControllerModules(() => root);
    const native = nativeBindings(() => root);
    let buildId = options.buildId ?? crypto.randomUUID();
    let resolvedCommand: string | undefined;
    let resolvedResolve: unknown;
    let resolvedCss: unknown;

    const CSS_EXTENSIONS = /\.(css|scss|less|sass|styl|stylus|pcss|postcss)($|\?)/;

    return {
        name: "finesoft-front",
        enforce: "pre" as const,

        config(userConfig: Record<string, any>) {
            const inherited = userConfig.define?.__FINESOFT_BUILD_ID__;
            if (typeof inherited === "string") buildId = JSON.parse(inherited);
            const overrides: Record<string, any> = {
                appType: "custom",
                ssr: { noExternal: ["@finesoft/front", "@finesoft/web", "@finesoft/ssr"] },
                define: {
                    __FINESOFT_BUILD_ID__: JSON.stringify(buildId),
                },
            };
            if (!process.env.__FINESOFT_SUB_BUILD__) {
                overrides.build = {
                    outDir: userConfig.build?.outDir ?? "dist/client",
                };
            }
            return overrides;
        },

        configResolved(config: Record<string, any>) {
            if (!process.env.__FINESOFT_SUB_BUILD__)
                generateFrontTypes({ root: config.root, ...options.controllerTypes });
            if (options.controllerTypes !== false && !process.env.__FINESOFT_SUB_BUILD__)
                generateControllerTypes({
                    ...options.controllerTypes,
                    root: options.controllerTypes?.root ?? config.root,
                });
            resolvedCommand = config.command as string;
            resolvedResolve = config.resolve;
            resolvedCss = config.css;
            root = config.root as string;
        },

        resolveId(
            this: any,
            id: string,
            importer?: string,
            buildOptions?: { ssr?: boolean; scan?: boolean },
        ) {
            if (id.startsWith("virtual:finesoft-front/native/"))
                return native.resolve(id, importer);
            serverControllers.guard(id, buildOptions?.ssr, this);
            if (id === "@finesoft/front") {
                return (async () => {
                    const resolveOptions = { ...buildOptions, skipSelf: true };
                    const resolved = await this.resolve(id, importer, resolveOptions);
                    // TypeScript's project facade must never become executable code,
                    // including during dependency scans that bypass load hooks.
                    if (
                        !resolved ||
                        normalizePathForGlob(resolved.id.split("?")[0]) !==
                            normalizePathForGlob(path.resolve(root, ".finesoft/front.d.ts"))
                    )
                        return resolved;
                    const front = createRequire(path.join(root, "package.json")).resolve(id);
                    const server =
                        buildOptions?.ssr ?? this.environment?.config?.consumer === "server";
                    const conditions: string[] | undefined =
                        this.environment?.config?.resolve?.conditions;
                    const node = server && (!conditions || conditions.includes("node"));
                    return this.resolve(
                        path.join(path.dirname(front), node ? "index-node.mjs" : "index.mjs"),
                        importer,
                        resolveOptions,
                    );
                })();
            }
            if (id === GENERATED_I18N_LOADER_ID && options.i18n?.messagesDir) {
                return RESOLVED_GENERATED_I18N_LOADER_ID;
            }
            if (buildOptions?.scan) {
                return (async () => {
                    const resolved = await this.resolve(id, importer, { skipSelf: true });
                    // Dependency scans read files without load hooks. Keep recognized server
                    // implementations opaque; ordinary loading still emits their browser proxies.
                    if (
                        resolved &&
                        (await serverControllers.load(this, resolved.id, buildOptions.ssr))
                    )
                        return `\0finesoft:server-controller-scan:${resolved.id}`;
                    return resolved;
                })();
            }
            return null;
        },

        async load(this: any, id: string, buildOptions?: { ssr?: boolean }) {
            const server = await serverControllers.load(this, id, buildOptions?.ssr);
            if (server) return server;
            if (id !== RESOLVED_GENERATED_I18N_LOADER_ID || !options.i18n?.messagesDir) {
                return null;
            }

            const messagesDir = await resolveMessagesDir(root, options.i18n.messagesDir);
            const baseDir = `/${messagesDir}`;
            const globPattern = `${baseDir}/*.json`;
            const filePrefix = `${baseDir}/`;

            return `
const localeModules = import.meta.glob(${JSON.stringify(globPattern)}, { import: "default" });

export async function loadMessages(locale) {
  const loader = localeModules[${JSON.stringify(filePrefix)} + locale + ".json"];
  if (!loader) return undefined;
  const messages = await loader();
  return messages ?? undefined;
}
`;
        },

        async buildStart(this: any) {
            await serverControllers.start(this);
        },

        transform: (code: string, id: string) => native.transform(code, id),

        watchChange(file: string) {
            serverControllers.invalidate(file);
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
            let timer: ReturnType<typeof setTimeout> | undefined;
            const typeWatcher =
                options.controllerTypes === false
                    ? undefined
                    : createControllerTypeWatcher({
                          ...options.controllerTypes,
                          root: options.controllerTypes?.root ?? root,
                      });
            const pending = new Set<string>();
            const refreshTypes = (event: string, file: string) => {
                if (
                    event !== "dependency" &&
                    (!/\.(?:[cm]?tsx?|json)$/.test(file) || file.includes("/.finesoft/"))
                )
                    return;
                clearTimeout(timer);
                pending.add(file);
                try {
                    if (typeWatcher?.update([...pending], true)) {
                        pending.clear();
                        return;
                    }
                } catch (error) {
                    server.config.logger.error(`[finesoft] ${String(error)}`);
                    pending.clear();
                    return;
                }
                timer = setTimeout(() => {
                    const files = [...pending];
                    pending.clear();
                    try {
                        typeWatcher?.update(files);
                    } catch (error) {
                        server.config.logger.error(`[finesoft] ${String(error)}`);
                    }
                }, 30);
            };
            if (options.controllerTypes !== false) {
                // Vite ignores node_modules; type-only and external schema inputs still invalidate.
                typeWatcher?.watch((file) => refreshTypes("dependency", file));
                server.watcher.on("all", refreshTypes);
                const close = server.close.bind(server);
                server.close = async () => {
                    clearTimeout(timer);
                    pending.clear();
                    server.watcher.off("all", refreshTypes);
                    typeWatcher?.close();
                    return await close();
                };
            }
            return async () => {
                const { Hono: HonoClass } = await dynamicImport("hono");
                const { getRequestListener } = await dynamicImport("@hono/node-server");

                printDevSafetyBanner();

                const app = new HonoClass();

                // Setup: 函数直接调用，文件路径通过 ssrLoadModule 加载
                if (typeof options.setup === "function") {
                    await options.setup(app);
                } else if (typeof options.setup === "string") {
                    const mod = await server.ssrLoadModule("/" + options.setup);
                    await mod.default(app);
                }

                // Application access checks must precede terminal proxy handlers.
                if (options.proxies?.length) {
                    registerProxyRoutes(app, options.proxies);
                }

                const ssrApp = createSSRApp({
                    root,
                    vite: server,
                    ssrEntryPath: "/" + ssrEntry,
                    parentFetch: app.fetch.bind(app),
                    renderModes: options.renderModes,
                    defaultLocale: options.defaultLocale,
                });
                app.route("/", ssrApp);
                const close = server.close.bind(server);
                server.close = async () => {
                    try {
                        await close();
                    } finally {
                        await ssrApp.dispose();
                    }
                };

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

                // Setup: 函数直接调用，文件路径从构建产物加载
                if (typeof options.setup === "function") {
                    await options.setup(app);
                } else if (typeof options.setup === "string") {
                    const setupPath = pathToFileURL(
                        path.resolve(root, "dist/server/setup.mjs"),
                    ).href;
                    const mod = await dynamicImport(setupPath);
                    await mod.default(app);
                }

                // A missing/failed setup must abort startup, never expose unguarded proxies.
                if (options.proxies?.length) {
                    registerProxyRoutes(app, options.proxies);
                }

                const templatePath = path.resolve(root, "dist/client/index.html");
                const template = readFileSync(templatePath, "utf-8");

                const ssrPath = pathToFileURL(path.resolve(root, "dist/server/ssr.js")).href;
                const ssrModule = (await dynamicImport(ssrPath)) as SSRModule;

                const owner = createSSRHandler({
                    ownRenderers: true,
                    template,
                    ...ssrModule,
                    fetch: (request, bindings) => app.fetch(request, bindings),
                    safeFetch: nodeSafeFetchOptions,
                    renderModes: options.renderModes,
                    defaultLocale: options.defaultLocale,
                    onError: (error) => console.error("[SSR Preview Error]", error),
                });
                app.all("*", (c: any) => owner.fetch(c.req.raw, c.env));
                const close = server.httpServer.close.bind(server.httpServer);
                server.httpServer.close = (callback?: (error?: Error) => void) =>
                    close((error?: Error) => {
                        void owner.dispose().then(
                            () => callback?.(error),
                            (cleanupError: Error) => callback?.(cleanupError),
                        );
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
                    define: { __FINESOFT_BUILD_ID__: JSON.stringify(buildId) },
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
                        define: { __FINESOFT_BUILD_ID__: JSON.stringify(buildId) },
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
                        buildId,
                        ssrEntry,
                        setupPath: typeof options.setup === "string" ? options.setup : undefined,
                        templateHtml,
                        renderModes: options.renderModes,
                        proxies: options.proxies,
                        locales: options.locales,
                        defaultLocale: options.defaultLocale,
                        resolvedResolve,
                        resolvedCss,
                        vite: {
                            ...vite,
                            build: (config: Record<string, any>) =>
                                vite.build({
                                    ...config,
                                    define: {
                                        ...config.define,
                                        __FINESOFT_BUILD_ID__: JSON.stringify(buildId),
                                    },
                                }),
                        },
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
