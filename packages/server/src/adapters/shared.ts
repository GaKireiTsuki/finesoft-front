/**
 * 适配器共享工具函数
 *
 * 提供 generateSSREntry / buildBundle / copyStaticAssets 三个方法，
 * 避免各适配器重复实现相同逻辑。
 */

import { createSSRHandler, type SSRModule } from "../ssr-handler";
import { isPublicSSRResult } from "../ssr-cache";
import { nodeSafeFetchOptions } from "../node/fetch-policy";
import { dynamicImport } from "../dynamic-import";
import { generateProxyCode } from "../proxy";
import type {
    AdapterContext,
    BuildBundleOptions,
    CopyStaticAssetsOptions,
    GenerateSSREntryOptions,
} from "./types";

const BUILD_TOOL_EXTERNALS = ["vite", "esbuild", "rollup", "fsevents", "lightningcss"];

/**
 * Common Node.js built-in modules. Listed explicitly so that Rolldown's
 * vite-resolve plugin does not emit "Automatically externalized" warnings.
 */
export const NODE_BUILTINS = [
    "node:async_hooks",
    "node:buffer",
    "node:crypto",
    "node:fs",
    "node:dns/promises",
    "node:http",
    "node:http2",
    "node:module",
    "node:net",
    "node:os",
    "node:path",
    "node:stream",
    "node:url",
    "node:util",
    "node:zlib",
    "crypto",
    "http",
    "http2",
    "stream",
];

/** Generated hosts compose routing/capabilities; HTML response semantics live in one portable owner. */
export function generateSSREntry(ctx: AdapterContext, opts: GenerateSSREntryOptions): string {
    return `
import { Hono } from "hono";
import { createSSRHost, registerProxyRoutes } from "@finesoft/front/ssr";
${opts.platformImport}
${opts.dnsPolicy === "hostname" ? "" : 'import { nodeSafeFetchOptions as _safeFetchOptions } from "@finesoft/front/node";'}
import { render, serializeServerData } from "./${ctx.ssrEntry}";
${ctx.setupPath ? `import _setupDefault from "./${ctx.setupPath}";` : ""}
const TEMPLATE = ${JSON.stringify(ctx.templateHtml)};
const RENDER_MODES = ${JSON.stringify(ctx.renderModes ?? {})};
const DEFAULT_LOCALE = ${JSON.stringify(ctx.defaultLocale ?? null)};
${opts.platformCache ?? ""}
const app = new Hono();
${generateProxyCode(ctx.proxies ?? [])}
${ctx.setupPath ? 'if (typeof _setupDefault === "function") await _setupDefault(app);' : ""}
${opts.platformMiddleware ?? ""}
const ssrHost = createSSRHost({
    template: TEMPLATE,
    render,
    serializeServerData,
    renderModes: RENDER_MODES,
    defaultLocale: DEFAULT_LOCALE,
    safeFetch: ${opts.dnsPolicy === "hostname" ? "{ validateDns: false }" : "_safeFetchOptions"},
    fetch: (request, bindings) => app.fetch(request, bindings),
    ${opts.platformCache ? "cache: {get: platformCacheGet, set: platformCacheSet}," : ""}
    ${opts.publicCacheHeaders ? `publicCacheHeaders: ${JSON.stringify(opts.publicCacheHeaders)},` : ""}
});
app.get("*", c => ssrHost.handle(c.req.raw, c.env));
${opts.platformExport}
`;
}

/** 用 Vite SSR 模式构建 bundle */
export async function buildBundle(ctx: AdapterContext, opts: BuildBundleOptions): Promise<void> {
    await ctx.vite.build({
        root: ctx.root,
        build: {
            ssr: opts.entry,
            outDir: opts.outDir,
            emptyOutDir: opts.emptyOutDir ?? true,
            target: opts.target ?? "node18",
            rollupOptions: {
                output: { entryFileNames: opts.fileName ?? "index.mjs" },
            },
        },
        ssr: {
            noExternal: opts.noExternal !== false,
            external: [...(opts.external ?? BUILD_TOOL_EXTERNALS), ...NODE_BUILTINS],
        },
        resolve: ctx.resolvedResolve,
        css: ctx.resolvedCss,
    });
}

/** 复制 dist/client 静态资源到目标目录 */
export function copyStaticAssets(
    ctx: AdapterContext,
    destDir: string,
    opts?: CopyStaticAssetsOptions,
): void {
    const { fs, path } = ctx;
    fs.cpSync(path.resolve(ctx.root, "dist/client"), destDir, {
        recursive: true,
    });
    if (opts?.excludeHtml !== false) {
        fs.rmSync(path.join(destDir, "index.html"), { force: true });
    }
}

/** Build a generated platform entry and remove it once Vite has consumed it. */
export async function buildGeneratedEntry(
    ctx: AdapterContext,
    entry: string,
    source: string,
    options: Omit<BuildBundleOptions, "entry">,
): Promise<void> {
    const temporaryPath = ctx.path.resolve(ctx.root, entry);
    ctx.fs.writeFileSync(temporaryPath, source);
    try {
        await buildBundle(ctx, { ...options, entry });
    } finally {
        ctx.fs.rmSync(temporaryPath, { force: true });
    }
}

export interface PrerenderResult {
    url: string;
    html: string;
}

/** Materialize prerendered pages with the path layout used by every request-host adapter. */
export function writePrerenderedPages(
    ctx: AdapterContext,
    outputDir: string,
    pages: Iterable<PrerenderResult>,
): void {
    for (const { url, html } of pages) {
        const file =
            url === "/"
                ? ctx.path.join(outputDir, "index.html")
                : ctx.path.join(outputDir, url, "index.html");
        ctx.fs.mkdirSync(ctx.path.resolve(file, ".."), { recursive: true });
        ctx.fs.writeFileSync(file, html);
    }
}

/**
 * 构建时预渲染 prerender 路由。
 *
 * 1. 加载路由定义文件，找出 renderMode === "prerender" 的路由
 * 2. 合并 ctx.renderModes 配置覆盖
 * 3. 渲染每个 URL × locale
 */
export async function prerenderRoutes(ctx: AdapterContext): Promise<PrerenderResult[]> {
    const { fs, path, root } = ctx;
    const { pathToFileURL } = await dynamicImport("node:url");
    const importVersion = ctx.buildId ? `?finesoft-build=${encodeURIComponent(ctx.buildId)}` : "";

    const routes: Array<{ path: string; renderMode?: string }> = [];
    const ssrFile = path.resolve(root, "dist/server/ssr.js");
    let ssrModule: SSRModule | undefined;
    if (fs.existsSync(ssrFile)) {
        ssrModule = await dynamicImport(pathToFileURL(ssrFile).href + importVersion);
        routes.push(...(ssrModule!.render.routes ?? []));
    }
    try {
        // ── 2. 收集 prerender 路径 ──
        const prerenderPaths = new Set<string>();

        // 路由定义级别
        for (const r of routes) {
            if (r.renderMode === "prerender" && r.path && !r.path.includes(":")) {
                prerenderPaths.add(r.path);
            }
        }

        // Vite 配置覆盖级别
        if (ctx.renderModes) {
            for (const [pattern, mode] of Object.entries(ctx.renderModes)) {
                if (mode === "prerender" && !pattern.includes("*") && !pattern.includes(":")) {
                    prerenderPaths.add(pattern);
                }
            }
        }

        // locale 矩阵展开
        if (ctx.locales?.length) {
            const basePaths = [...prerenderPaths];
            for (const locale of ctx.locales) {
                for (const basePath of basePaths) {
                    const localePath = basePath === "/" ? `/${locale}` : `/${locale}${basePath}`;
                    prerenderPaths.add(localePath);
                }
            }
        }

        if (prerenderPaths.size === 0) return [];

        // ── 3. 加载 SSR 模块 ──
        ssrModule ??= await dynamicImport(pathToFileURL(ssrFile).href + importVersion);

        // ── 4. 渲染每个 URL ──
        const results: PrerenderResult[] = [];

        for (const url of prerenderPaths) {
            try {
                let eligible = false;
                const handler = createSSRHandler({
                    template: ctx.templateHtml,
                    render: async (path, context) => {
                        const result = await (ssrModule as SSRModule).render(path, context);
                        eligible = isPublicSSRResult(result);
                        return result;
                    },
                    serializeServerData: ssrModule!.serializeServerData,
                    defaultLocale: ctx.defaultLocale,
                    renderModes: ctx.renderModes,
                    safeFetch: nodeSafeFetchOptions,
                    onError: (error) =>
                        console.warn(`  [prerender] Failed to render ${url}:`, error),
                });
                const response = await handler(new Request(new URL(url, "http://prerender.local")));
                if (eligible && response.status === 200)
                    results.push({ url, html: await response.text() });
            } catch (e) {
                console.warn(`  [prerender] Failed to render ${url}:`, e);
            }
        }

        if (results.length > 0) {
            console.log(`  Pre-rendered ${results.length} pages (${prerenderPaths.size} routes)\n`);
        }

        return results;
    } finally {
        await ssrModule?.render.dispose?.();
    }
}
