/**
 * createSSRApp — 创建 Hono SSR 应用
 *
 * 提供 SSR 通配路由，读取模板、加载 SSR 模块、渲染。
 * 应用层可在此之上追加自定义路由（API 代理等）。
 */

import { injectCSRShell, injectSSRContent } from "@finesoft/ssr";
import { Hono } from "hono";
import type { ViteDevServer } from "vite";
import {
	createInternalFetch,
	MAX_SSR_DEPTH,
	SSR_DEPTH_HEADER,
} from "./internal-fetch";
import { parseAcceptLanguage } from "./locale";

/**
 * 匹配 Vite 配置级别的 renderMode 覆盖。
 * 精确路径优先，然后 glob 模式。
 */
function matchRenderModeOverride(
	url: string,
	renderModes?: Record<string, string>,
): string | null {
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
		locale: string,
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
	}>;
	serializeServerData: (data: unknown) => string;
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
	/** 支持的语言列表 */
	supportedLocales?: string[];
	/** 默认语言 */
	defaultLocale?: string;
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
}

export function createSSRApp(options: SSRAppOptions): Hono {
	const {
		root,
		vite,
		isProduction,
		ssrEntryPath = "/src/ssr.ts",
		ssrProductionModule,
		supportedLocales,
		defaultLocale,
		parentFetch,
		renderModes,
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
			const { readFileSync } = await import(/* @vite-ignore */ "node:fs");
			const { resolve } = await import(/* @vite-ignore */ "node:path");
			const raw = readFileSync(resolve(root, "index.html"), "utf-8");
			return vite.transformIndexHtml(url, raw);
		}

		if (templateCache) return templateCache;

		const isDeno = typeof (globalThis as any).Deno !== "undefined";
		if (isDeno) {
			templateCache = (globalThis as any).Deno.readTextFileSync(
				new URL("../dist/client/index.html", import.meta.url),
			);
			return templateCache!;
		}

		const { readFileSync } = await import(/* @vite-ignore */ "node:fs");
		const { resolve } = await import(/* @vite-ignore */ "node:path");
		templateCache = readFileSync(
			resolve(root, "dist/client/index.html"),
			"utf-8",
		);
		return templateCache!;
	}

	async function loadSSRModule(): Promise<SSRModule> {
		if (!isProduction && vite) {
			return (await vite.ssrLoadModule(ssrEntryPath)) as SSRModule;
		}
		if (ssrProductionModule) {
			return import(
				/* @vite-ignore */ ssrProductionModule
			) as Promise<SSRModule>;
		}
		const { resolve } = await import(/* @vite-ignore */ "node:path");
		const { pathToFileURL } = await import(/* @vite-ignore */ "node:url");
		const absPath = pathToFileURL(resolve(root, "dist/server/ssr.js")).href;
		return import(/* @vite-ignore */ absPath) as Promise<SSRModule>;
	}

	app.get("*", async (c) => {
		// 递归深度保护：从请求头读取 SSR 深度
		const ssrDepth = parseInt(c.req.header(SSR_DEPTH_HEADER) ?? "0", 10);
		if (ssrDepth >= MAX_SSR_DEPTH) {
			return c.text("SSR recursion loop detected", 508);
		}

		const url =
			c.req.path +
			(c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "");

		try {
			const template = await readTemplate(url);
			const { render, serializeServerData } = await loadSSRModule();

			const locale = parseAcceptLanguage(
				c.req.header("accept-language"),
				supportedLocales,
				defaultLocale,
			);

			// Vite 配置级别覆盖：CSR 直接返回空壳
			const overrideMode = matchRenderModeOverride(url, renderModes);
			if (overrideMode === "csr") {
				return c.html(injectCSRShell(template, locale));
			}

			// ISR 缓存命中（key 含 locale，避免跨语言缓存污染）
			const cacheKey = `${locale}:${url}`;
			const cached = isrCache.get(cacheKey);
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
			} = await render(url, locale, ssrContext);

			// 中间件要求重定向
			if (middlewareRedirect) {
				return c.redirect(
					middlewareRedirect.url,
					middlewareRedirect.status as 301 | 302,
				);
			}

			// CSR 模式：返回空壳 HTML
			if (renderMode === "csr") {
				return c.html(injectCSRShell(template, locale));
			}

			const serializedData = serializeServerData(serverData);

			const finalHtml = injectSSRContent({
				template,
				locale,
				head,
				css,
				html: appHtml,
				serializedData,
			});

			// Prerender ISR 缓存（包括 Vite 配置覆盖和路由级）
			if (renderMode === "prerender" || overrideMode === "prerender") {
				isrSet(cacheKey, finalHtml);
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
