/**
 * 适配器共享工具函数
 *
 * 提供 generateSSREntry / buildBundle / copyStaticAssets 三个方法，
 * 避免各适配器重复实现相同逻辑。
 */

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

/**
 * 生成 SSR serverless/edge 入口源码
 *
 * 内联 injectSSR 以避免
 * @finesoft/front → @finesoft/server → vite-plugin → import("vite") 依赖链。
 */
export function generateSSREntry(ctx: AdapterContext, opts: GenerateSSREntryOptions): string {
    const setupImport = ctx.setupPath ? `import _setupDefault from "./${ctx.setupPath}";` : ``;
    const setupCall = ctx.setupPath
        ? `if (typeof _setupDefault === "function") await _setupDefault(app);`
        : ``;

    const renderModes = JSON.stringify(ctx.renderModes ?? {});

    // 平台缓存实现：平台自定义 或 内置内存 Map
    const cacheImpl = opts.platformCache
        ? opts.platformCache
        : `
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
}`;

    return `
import { Hono } from "hono";
${opts.platformImport}
import { render, serializeServerData } from "./${ctx.ssrEntry}";
${setupImport}

const TEMPLATE = ${JSON.stringify(ctx.templateHtml)};
const RENDER_MODES = ${renderModes};
const DEFAULT_LOCALE = ${JSON.stringify(ctx.defaultLocale ?? null)};
${cacheImpl}

function injectSSR(t, head, css, html, data, locale) {
  const injected = t
    .replace(/<!--ssr-([a-z][a-z0-9-]*)-->/g, (_, name) => {
      const replacements = {
        head: head + "\n<style>" + css + "</style>",
        body: html,
        data: '<script id="serialized-server-data" type="application/json">' + data + "</script>",
      };
      return replacements[name] ?? "";
    });
  return applyLocaleToHtml(injected, locale);
}

function applyLocaleToHtml(html, locale) {
  if (!locale) return html;
  return html.replace(/<html([^>]*)>/, (_, attrs) => {
    let a = attrs.replace(/s*lang="[^"]*"/g, "").replace(/s*dir="[^"]*"/g, "");
    return "<html" + a + ' lang="' + locale.lang + '" dir="' + locale.dir + '">';
  });
}

function getLocaleAttrs(lang) {
  if (!lang) return undefined;
  const RTL = new Set(["ar","arc","dv","fa","ha","he","khw","ks","ku","ps","ur","yi"]);
  const base = lang.split(/[-_]/)[0].toLowerCase();
  return { lang: lang, dir: RTL.has(base) ? "rtl" : "ltr" };
}

function injectCSRShell(t, locale) {
  const stripped = t.replace(/<!--ssr-([a-z][a-z0-9-]*)-->/g, () => "");
  return applyLocaleToHtml(stripped, locale);
}

function matchRenderMode(url) {
  const path = url.split("?")[0];
  if (RENDER_MODES[path]) return RENDER_MODES[path];
  for (const [pattern, mode] of Object.entries(RENDER_MODES)) {
    if (pattern.includes("*")) {
      const escaped = pattern.replace(/[.+?^\${}()|[\\]\\\\]/g, "\\\\$&");
      const re = new RegExp("^" + escaped.replace(/\\*/g, ".*") + "$");
      if (re.test(path)) return mode;
    }
  }
  return null;
}

const app = new Hono();
${generateProxyCode(ctx.proxies ?? [])}
${setupCall}
${opts.platformMiddleware ?? ""}

// 内部 fetch 回环：SSR 控制器的 fetch 请求直接走 Hono 内存路由
// 深度通过请求头传递，并发安全且能跨渲染正确追踪递归
const _SSR_DEPTH_HEADER = "x-ssr-depth";
const _MAX_SSR_DEPTH = 5;

function _createInternalFetch(depth) {
  return function(input, init) {
    if (typeof input === "string" && input.startsWith("/")) {
      const req = new Request("http://localhost" + input, init);
      req.headers.set(_SSR_DEPTH_HEADER, String(depth));
      return app.fetch(req);
    }
    return globalThis.fetch(input, init);
  };
}

app.get("*", async (c) => {
  // 递归深度保护：从请求头读取 SSR 深度
  const _ssrDepth = parseInt(c.req.header(_SSR_DEPTH_HEADER) || "0", 10);
  if (_ssrDepth >= _MAX_SSR_DEPTH) {
    return c.text("SSR recursion loop detected", 508);
  }

  const url = c.req.path + (c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "");
  try {
    // Vite 配置级别覆盖: CSR 直接返回空壳
    const overrideMode = matchRenderMode(url);
    if (overrideMode === "csr") {
      return c.html(injectCSRShell(TEMPLATE, getLocaleAttrs(DEFAULT_LOCALE)));
    }

    // ISR 缓存命中
    const cached = await platformCacheGet(url);
    if (cached) return c.html(cached);

    const { html: appHtml, head, css, serverData, renderMode, locale } = await render(url, { fetch: _createInternalFetch(_ssrDepth + 1) });
    const localeAttrs = getLocaleAttrs(locale || DEFAULT_LOCALE);

    // 路由级 CSR
    if (renderMode === "csr") {
      return c.html(injectCSRShell(TEMPLATE, localeAttrs));
    }

    const serializedData = serializeServerData(serverData);
    const finalHtml = injectSSR(TEMPLATE, head, css, appHtml, serializedData, localeAttrs);

    // Prerender ISR 缓存（包括 Vite 配置覆盖和路由级）
    if (renderMode === "prerender" || overrideMode === "prerender") {
      await platformCacheSet(url, finalHtml);
      ${opts.platformPrerenderResponseHook ?? ""}
    }

    return c.html(finalHtml);
  } catch (e) {
    console.error("[SSR Error]", e);
    return c.text("Internal Server Error", 500);
  }
});

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

export interface PrerenderResult {
    url: string;
    html: string;
}

/**
 * 构建时预渲染 prerender 路由。
 *
 * 1. 加载路由定义文件，找出 renderMode === "prerender" 的路由
 * 2. 合并 ctx.renderModes 配置覆盖
 * 3. 渲染每个 URL × locale
 */
export async function prerenderRoutes(ctx: AdapterContext): Promise<PrerenderResult[]> {
    const { fs, path, root, vite } = ctx;
    const { pathToFileURL } = await dynamicImport("node:url");

    const routesExport = ctx.bootstrapEntry ?? "src/lib/bootstrap.ts";

    // ── 1. 尝试构建并加载路由定义（文件不存在则跳过） ──
    let routes: Array<{ path: string; renderMode?: string }> = [];
    const routesFileExists = fs.existsSync(path.resolve(root, routesExport));

    if (routesFileExists) {
        await vite.build({
            root,
            build: {
                ssr: routesExport,
                outDir: path.resolve(root, "dist/server"),
                emptyOutDir: false,
                rollupOptions: {
                    output: { entryFileNames: "_routes_prerender.mjs" },
                },
            },
            resolve: ctx.resolvedResolve,
        });

        const routesPath = pathToFileURL(
            path.resolve(root, "dist/server/_routes_prerender.mjs"),
        ).href;
        const routesMod = await dynamicImport(routesPath);
        routes = routesMod.routes ?? routesMod.default ?? [];

        // 清理临时文件
        fs.rmSync(path.resolve(root, "dist/server/_routes_prerender.mjs"), {
            force: true,
        });
    }

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
    const ssrPath = pathToFileURL(path.resolve(root, "dist/server/ssr.js")).href;
    const ssrModule = await dynamicImport(ssrPath);

    // ── 4. 渲染每个 URL ──
    const results: PrerenderResult[] = [];

    for (const url of prerenderPaths) {
        try {
            const { html: appHtml, head, css, serverData, locale } = await ssrModule.render(url);

            const serializedData = ssrModule.serializeServerData(serverData);

            let finalHtml = ctx.templateHtml.replace(
                /<!--ssr-([a-z][a-z0-9-]*)-->/g,
                (_match, name: string) => {
                    const builtIn: Record<string, string> = {
                        head: head + "\n<style>" + css + "</style>",
                        body: appHtml,
                        data:
                            '<script id="serialized-server-data" type="application/json">' +
                            serializedData +
                            "</script>",
                    };
                    return builtIn[name] ?? "";
                },
            );

            // 注入 locale 到 <html> 标签
            if (locale) {
                const { getLocaleAttributes } = await dynamicImport("@finesoft/core");
                const attrs = getLocaleAttributes(locale);
                finalHtml = finalHtml.replace(/<html([^>]*)>/, (_m: string, a: string) => {
                    const cleaned = a
                        .replace(/\s*lang="[^"]*"/g, "")
                        .replace(/\s*dir="[^"]*"/g, "");
                    return `<html${cleaned} lang="${attrs.lang}" dir="${attrs.dir}">`;
                });
            }

            results.push({ url, html: finalHtml });
        } catch (e) {
            console.warn(`  [prerender] Failed to render ${url}:`, e);
        }
    }

    if (results.length > 0) {
        console.log(`  Pre-rendered ${results.length} pages (${prerenderPaths.size} routes)\n`);
    }

    return results;
}
