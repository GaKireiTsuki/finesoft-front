/**
 * Static 适配器 — 构建时预渲染
 *
 * 加载 SSR 模块和路由定义，将无参数路由自动预渲染为静态 HTML。
 * 动态参数路由通过 dynamicRoutes 选项补充具体 URL。
 *
 * 输出：dist/static/ — 纯静态站点，可部署到任何静态托管。
 */

import { dynamicImport } from "../dynamic-import";
import type { Adapter, AdapterContext } from "./types";

export interface StaticAdapterOptions {
    /**
     * 导出 routes 数组的文件路径（相对于项目根目录）。
     * 默认 "src/lib/bootstrap.ts"。
     * 文件需 export 一个 RouteDefinition[] 类型的 routes 变量。
     */
    routesExport?: string;
    /**
     * 额外的动态路由 URL（带具体参数值），如：
     * ["/product/123", "/list/games"]
     */
    dynamicRoutes?: string[];
}

export function staticAdapter(opts: StaticAdapterOptions = {}): Adapter {
    return {
        name: "static",
        async build(ctx) {
            const { fs, path, root } = ctx;
            const outputDir = path.resolve(root, "dist/static");

            fs.rmSync(outputDir, { recursive: true, force: true });
            fs.mkdirSync(outputDir, { recursive: true });

            // 加载 SSR 模块
            const { pathToFileURL } = await dynamicImport("node:url");
            const ssrPath = pathToFileURL(path.resolve(root, "dist/server/ssr.js")).href;
            const ssrModule = await dynamicImport(ssrPath);

            // 先复制静态资源（JS/CSS 等），排除模板 index.html
            ctx.copyStaticAssets(outputDir, { excludeHtml: true });

            // 提取路由列表（含 renderMode）
            const { paths: routePaths, defs: routeDefs } = await extractRoutesWithModes(ctx, opts);
            const allUrls: string[] = [];

            // 对每个路由 × 每个 locale 生成 URL
            for (const routePath of routePaths) {
                for (const locale of ctx.locales) {
                    const url =
                        locale === ctx.defaultLocale
                            ? routePath
                            : `/${locale}${routePath === "/" ? "" : routePath}`;
                    allUrls.push(url);
                }
            }

            console.log(
                `  Pre-rendering ${allUrls.length} pages (${routePaths.length} routes × ${ctx.locales.length} locales)...\n`,
            );

            // 预渲染每个 URL
            for (const url of allUrls) {
                try {
                    // 从 URL 推断 locale
                    const locale = inferLocale(url, ctx.locales, ctx.defaultLocale);

                    // 检查渲染模式：路由级 + Vite 配置覆盖
                    const routeDef = routeDefs.find(
                        (r) => r.path === stripLocalePrefix(url, ctx.locales),
                    );
                    const mode = resolveRenderMode(
                        stripLocalePrefix(url, ctx.locales),
                        routeDef?.renderMode,
                        ctx.renderModes,
                    );

                    let finalHtml: string;

                    if (mode === "csr") {
                        // CSR: 空壳 HTML，客户端 JS 渲染
                        finalHtml = injectCSRShellForStatic(ctx.templateHtml, locale);
                    } else {
                        const {
                            html: appHtml,
                            head,
                            css,
                            serverData,
                        } = await ssrModule.render(url, locale);

                        const serializedData = ssrModule.serializeServerData(serverData);

                        finalHtml = injectSSRForStatic(
                            ctx.templateHtml,
                            locale,
                            head,
                            css,
                            appHtml,
                            serializedData,
                        );
                    }

                    // 写入文件：/foo → dist/static/foo/index.html
                    const filePath =
                        url === "/"
                            ? path.join(outputDir, "index.html")
                            : path.join(outputDir, url, "index.html");

                    fs.mkdirSync(path.resolve(filePath, ".."), {
                        recursive: true,
                    });
                    fs.writeFileSync(filePath, finalHtml);
                } catch (e) {
                    console.warn(`  [static] Failed to render ${url}:`, e);
                }
            }

            console.log(`  Static output → dist/static/\n`);
        },
    };
}

/** 从路由文件提取无参数路由 + 合并 dynamicRoutes（含 renderMode） */
async function extractRoutesWithModes(
    ctx: AdapterContext,
    opts: StaticAdapterOptions,
): Promise<{
    paths: string[];
    defs: Array<{ path: string; renderMode?: string }>;
}> {
    const routesFile = opts.routesExport ?? "src/lib/bootstrap.ts";
    const paths: string[] = [];
    const defs: Array<{ path: string; renderMode?: string }> = [];

    try {
        // 使用 Vite SSR 构建加载路由文件
        const { pathToFileURL } = await dynamicImport("node:url");

        // 先构建路由文件
        await ctx.vite.build({
            root: ctx.root,
            build: {
                ssr: routesFile,
                outDir: ctx.path.resolve(ctx.root, "dist/server"),
                emptyOutDir: false,
                rollupOptions: {
                    output: { entryFileNames: "_routes.mjs" },
                },
            },
            resolve: ctx.resolvedResolve,
        });

        const routesPath = pathToFileURL(
            ctx.path.resolve(ctx.root, "dist/server/_routes.mjs"),
        ).href;
        const routesMod = await dynamicImport(routesPath);

        // 查找导出的 routes 数组
        const routes: Array<{ path: string; renderMode?: string }> =
            routesMod.routes ?? routesMod.default;

        if (Array.isArray(routes)) {
            for (const r of routes) {
                if (r.path && !r.path.includes(":")) {
                    paths.push(r.path);
                    defs.push({ path: r.path, renderMode: r.renderMode });
                }
            }
        }

        // 清理临时文件
        ctx.fs.rmSync(ctx.path.resolve(ctx.root, "dist/server/_routes.mjs"), {
            force: true,
        });
    } catch (e) {
        console.warn(`  [static] Could not load routes from "${routesFile}". Using "/" only.`, e);
        if (paths.length === 0) paths.push("/");
    }

    // 合并 dynamicRoutes
    if (opts.dynamicRoutes) {
        for (const r of opts.dynamicRoutes) {
            if (!paths.includes(r)) paths.push(r);
        }
    }

    // 至少包含根路径
    if (paths.length === 0) paths.push("/");

    return { paths, defs };
}

/** 从 URL 推断 locale */
function inferLocale(url: string, locales: string[], defaultLocale: string): string {
    const segments = url.split("/").filter(Boolean);
    if (segments.length > 0 && locales.includes(segments[0])) {
        return segments[0];
    }
    return defaultLocale;
}

/** 内联 SSR 注入（同 shared 中的逻辑） */
function injectSSRForStatic(
    template: string,
    locale: string,
    head: string,
    css: string,
    html: string,
    serializedData: string,
): string {
    return template
        .replace("<!--ssr-lang-->", locale)
        .replace("<!--ssr-head-->", head + "\n<style>" + css + "</style>")
        .replace("<!--ssr-body-->", html)
        .replace(
            "<!--ssr-data-->",
            '<script id="serialized-server-data" type="application/json">' +
                serializedData +
                "</script>",
        );
}

/** CSR 空壳注入 */
function injectCSRShellForStatic(template: string, locale: string): string {
    return template
        .replace("<!--ssr-lang-->", locale)
        .replace("<!--ssr-head-->", "")
        .replace("<!--ssr-body-->", "")
        .replace("<!--ssr-data-->", "");
}

/** 从 URL 去除 locale 前缀，还原路由路径 */
function stripLocalePrefix(url: string, locales: string[]): string {
    const segments = url.split("/").filter(Boolean);
    if (segments.length > 0 && locales.includes(segments[0])) {
        const rest = segments.slice(1).join("/");
        return rest ? `/${rest}` : "/";
    }
    return url;
}

/** 解析最终渲染模式：Vite 配置覆盖 > 路由级 > 默认 "ssr" */
function resolveRenderMode(
    routePath: string,
    routeRenderMode?: string,
    renderModes?: Record<string, string>,
): string {
    // Vite 配置覆盖优先
    if (renderModes) {
        if (renderModes[routePath]) return renderModes[routePath];
        for (const [pattern, mode] of Object.entries(renderModes)) {
            if (pattern.includes("*")) {
                const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
                const re = new RegExp("^" + escaped.replace(/\*/g, ".*") + "$");
                if (re.test(routePath)) return mode;
            }
        }
    }
    return routeRenderMode ?? "ssr";
}
