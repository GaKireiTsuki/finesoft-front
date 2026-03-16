/**
 * Adapter 接口定义
 *
 * 每个适配器实现 Adapter 接口，在 vite build 的 closeBundle 阶段
 * 接收 AdapterContext 并生成目标平台的部署产物。
 */

import type { ProxyRouteConfig } from "../proxy";

/** 适配器上下文 — 由 vite-plugin 的 closeBundle 构造后传入 adapter.build() */
export interface AdapterContext {
	/** 项目根路径 */
	root: string;
	/** SSR 入口文件相对路径（如 "src/ssr.ts"） */
	ssrEntry: string;
	/** setup 文件相对路径（如 "src/proxies.ts"），仅当 options.setup 为 string 时有值 */
	setupPath?: string;
	/** 路由定义入口文件（用于预渲染时加载路由），如 "src/lib/bootstrap.ts" */
	bootstrapEntry?: string;
	/** 支持的语言列表 */
	locales: string[];
	/** 默认语言 */
	defaultLocale: string;
	/** dist/client/index.html 的内容 */
	templateHtml: string;
	/** Vite 的 resolve 配置 */
	resolvedResolve: unknown;
	/** Vite 的 css 配置 */
	resolvedCss: unknown;
	/**
	 * 按路由覆盖的渲染模式。
	 * key: 精确路径或 glob 模式，value: "ssr" | "csr" | "prerender"
	 */
	renderModes?: Record<string, string>;
	/** 声明式代理路由配置 */
	proxies?: ProxyRouteConfig[];

	// ─── 工具模块（由 closeBundle 动态 import 后注入） ──────
	vite: any;
	fs: typeof import("node:fs");
	path: {
		resolve: (...args: string[]) => string;
		join: (...args: string[]) => string;
	};

	// ─── 共享工具方法 ──────────────────────────────────────────
	/** 生成 serverless/edge function 入口源码 */
	generateSSREntry(opts: GenerateSSREntryOptions): string;
	/** 用 Vite SSR 模式构建 bundle */
	buildBundle(opts: BuildBundleOptions): Promise<void>;
	/** 复制 dist/client 静态资源到目标目录 */
	copyStaticAssets(destDir: string, opts?: CopyStaticAssetsOptions): void;
}

export interface GenerateSSREntryOptions {
	/** 平台特定的导入语句（如 `import { handle } from "hono/vercel";`） */
	platformImport: string;
	/** 平台特定的导出语句（如 `export default handle(app);`） */
	platformExport: string;
	/**
	 * 平台特定的 ISR 缓存实现代码（可选）。
	 * 需提供 `async function platformCacheGet(url)` 返回 string|null，
	 * 和 `async function platformCacheSet(url, html)` 的函数定义。
	 * 不提供时使用内置的内存 Map 缓存。
	 */
	platformCache?: string;
	/**
	 * 平台特定的响应后处理代码（可选）。
	 * 在 prerender 路由返回前执行，可用于设置 CDN 缓存头等。
	 * 代码中可使用变量 `c`（Hono Context）。
	 */
	platformPrerenderResponseHook?: string;
	/**
	 * 平台特定的中间件代码（可选）。
	 * 插入在 catch-all GET 路由之前，可用于添加静态文件服务等。
	 * 代码中可使用变量 `app`（Hono 实例）。
	 */
	platformMiddleware?: string;
}

export interface BuildBundleOptions {
	/** 临时入口文件路径 */
	entry: string;
	/** 输出目录 */
	outDir: string;
	/** 构建 target（默认 "node18"） */
	target?: string;
	/** 输出文件名（默认 "index.mjs"） */
	fileName?: string;
	/** 排除的模块（默认 ["vite", "esbuild", "rollup", "fsevents", "lightningcss"]） */
	external?: string[];
	/** 是否打包所有依赖（默认 true） */
	noExternal?: boolean;
}

export interface CopyStaticAssetsOptions {
	/** 是否排除 index.html（默认 true） */
	excludeHtml?: boolean;
}

/** 适配器接口 */
export interface Adapter {
	/** 适配器名称（用于日志） */
	name: string;
	/** 生成目标平台部署产物 */
	build(ctx: AdapterContext): Promise<void>;
}
