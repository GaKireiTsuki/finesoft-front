import { materializeServerData } from "./server-data";
import type { SecureFetchOptions } from "@finesoft/core";
/**
 * ssrRender — 通用 SSR 渲染管线
 *
 * 1. 创建 Framework + 注册 Controllers
 * 2. routeUrl → Intent
 * 3. dispatch → Page 数据
 * 4. 调用应用层提供的渲染函数
 */

import { type TranslationMessages } from "@finesoft/core";
import { Framework, loadPage, type BasePage } from "@finesoft/web";
import { createServerContext } from "./middleware/context";
import {
    resolveConfiguredMessages,
    type FrameworkConfig,
    type MessagesLoader,
    type PrefetchedIntent,
} from "@finesoft/web";

interface InternalSSRFrameworkConfig extends FrameworkConfig {
    _resolvedMessages?: TranslationMessages;
}

export interface SSRRenderOptions {
    /** 请求 URL */
    url: string;
    /** Framework 配置（含路由注册等） */
    frameworkConfig: FrameworkConfig;
    /** 注册 controllers 和路由的引导函数 */
    /** 获取错误页面 */
    getErrorPage: (status: number, message: string) => BasePage;
    /** 应用层渲染函数（如 Svelte SSR render / Vue renderToString） */
    renderApp: (page: BasePage, framework: Framework) => SSRAppResult | Promise<SSRAppResult>;
    /** 可选的 SSR 请求上下文（如自定义 fetch） */
    ssrContext?: SSRContext;
    /** 解析请求 locale 的回调（返回 lang + dir 用于 <html> 属性） */
    resolveLocale?: (url: string, request?: Request) => { lang: string; dir: string } | undefined;
    /** 异步加载当前 locale 的翻译字典 */
    loadMessages?: MessagesLoader;
}

/** SSR 请求级上下文 */
export interface SSRContext {
    identity?: string;
    traceId?: string;
    safeFetch?: SecureFetchOptions;
    /** 自定义 fetch（如 Hono 内部路由回环） */
    fetch?: typeof globalThis.fetch;
    /** 原始 Request 对象（用于中间件读取 cookie/header） */
    request?: Request;
    /** Host bindings for this invocation; data runtimes must receive these in Invocation. */
    bindings?: Readonly<Record<string, unknown>>;
}

export interface SSRAppResult {
    html: string;
    head: string;
    css: string;
    /** 自定义 slot 替换：`{ "my-slot": "<div>...</div>" }` 对应 HTML 中的 `<!--ssr-my-slot-->` */
    slots?: Record<string, string>;
}

export interface SSRRenderResult {
    /** Response metadata is assembled by the portable HTTP handler. */
    headers?: HeadersInit;
    /** Explicitly public output; guards still run before shared HTML cache reads. */
    cache?: "public";
    html: string;
    head: string;
    css: string;
    serverData: PrefetchedIntent[];
    /** 该路由的渲染模式（由 Router 返回） */
    renderMode?: string;
    /** 中间件要求的重定向（服务端应返回 HTTP 301/302） */
    redirect?: { url: string; status: number };
    /** 自定义 slot 替换 */
    slots?: Record<string, string>;
    /** 解析出的 locale 属性（用于 <html lang="" dir="">） */
    locale?: { lang: string; dir: string };
    /** 中间件 deny 时的 HTTP 状态码（服务端应据此设置 response status） */
    status?: number;
    /**
     * afterLoad rewrite 产生的内部 URL。
     * 此时数据按原 URL 已加载，页面正常渲染——rewriteUrl 仅供 server 层
     * 用于 canonical link / response header 等场景，**不会触发 HTTP 跳转**。
     */
    rewriteUrl?: string;
}

/** SSR 内部 rewrite 最大递归深度，防止 guard 配置错导致无限重路由 */
const MAX_SSR_REWRITE_DEPTH = 5;

export async function ssrRender(options: SSRRenderOptions): Promise<SSRRenderResult> {
    return ssrRenderInternal(options, 0);
}

async function ssrRenderInternal(
    options: SSRRenderOptions,
    rewriteDepth: number,
): Promise<SSRRenderResult> {
    if (rewriteDepth >= MAX_SSR_REWRITE_DEPTH) {
        throw new Error(
            `[SSR] Rewrite recursion depth exceeded (max ${MAX_SSR_REWRITE_DEPTH}) at "${options.url}"`,
        );
    }

    const {
        url,
        frameworkConfig,
        getErrorPage,
        renderApp,
        ssrContext,
        resolveLocale,
        loadMessages,
    } = options;

    const parsed = new URL(url, "http://localhost");
    const fullPath = parsed.pathname + parsed.search;

    // 先解析 locale（如果提供了 resolveLocale 回调），使 DI 容器获得正确的 locale
    const resolvedLocale = resolveLocale?.(url, ssrContext?.request);
    const defaults = { ...frameworkConfig.definition?.frameworkConfig, ...frameworkConfig };
    const effectiveConfig: FrameworkConfig = resolvedLocale
        ? { ...defaults, locale: resolvedLocale.lang }
        : defaults;
    const resolvedMessages = await resolveConfiguredMessages({
        locale: effectiveConfig.locale,
        loadMessages,
        context: effectiveConfig.locale
            ? {
                  runtime: "server",
                  fetch: getSSRFetch(ssrContext?.fetch ?? effectiveConfig.fetch),
                  url: fullPath,
                  request: ssrContext?.request,
              }
            : undefined,
    });

    // 将 SSR 上下文中的 fetch 合并到 frameworkConfig，注入 DI 容器
    const mergedConfig: FrameworkConfig = {
        ...effectiveConfig,
        fetch: getSSRFetch(ssrContext?.fetch ?? effectiveConfig.fetch),
        safeFetch: { ...ssrContext?.safeFetch, ...effectiveConfig.safeFetch },
    };

    const framework = Framework.create({
        ...mergedConfig,
        _resolvedMessages: resolvedMessages,
    } as InternalSSRFrameworkConfig);
    const execution = framework.createExecution({
        signal: ssrContext?.request?.signal,
        identity: ssrContext?.identity,
        traceId: ssrContext?.traceId,
        fetch: ssrContext?.fetch,
        bindings: { ...ssrContext?.bindings, request: ssrContext?.request },
    });

    try {
        const match = await framework.routeUrl(fullPath);

        // CSR 模式：跳过服务端渲染，返回空内容由客户端 JS 渲染
        if (match?.renderMode === "csr") {
            return {
                html: "",
                head: "",
                css: "",
                serverData: [],
                renderMode: "csr",
            };
        }

        const loaded = await loadPage({
            framework,
            target: fullPath,
            execution,
            createContext: ({ url: destinationUrl, intent, execution: active }) =>
                createServerContext({
                    url: destinationUrl,
                    intent,
                    container: active.context.container,
                    request: ssrContext?.request,
                }),
        });
        if (loaded.kind === "redirect")
            return {
                html: "",
                head: "",
                css: "",
                serverData: [],
                redirect: { url: loaded.url, status: loaded.status },
            };
        const page =
            loaded.kind === "page" ? loaded.page : getErrorPage(loaded.status, loaded.message);
        const serverData: PrefetchedIntent[] =
            loaded.kind === "page"
                ? [
                      {
                          entryId: loaded.target.entryId,
                          intent: { id: loaded.target.intent, params: loaded.target.params },
                          data: page,
                      },
                  ]
                : [];
        const rewriteUrl = loaded.kind === "page" ? loaded.rewriteUrl : undefined;

        if (loaded.kind === "page") framework.currentEntry = loaded.target;
        const result = await renderApp(page, framework);

        // locale 属性：已在渲染前通过 resolveLocale 解析（若有），否则从 Framework 容器获取
        const locale = resolvedLocale ?? framework.getLocale();

        return {
            html: result.html,
            head: result.head,
            css: result.css,
            serverData: materializeServerData(serverData),
            renderMode: loaded.kind === "page" ? loaded.match?.renderMode : match?.renderMode,
            ...(loaded.kind === "page" && loaded.match?.cache === "public"
                ? { cache: "public" as const }
                : {}),
            slots: result.slots,
            locale,
            rewriteUrl,
            ...(loaded.kind === "deny" ? { status: loaded.status } : {}),
        };
    } finally {
        await framework.dispose();
    }
}

function getSSRFetch(fetchFn?: typeof globalThis.fetch): typeof globalThis.fetch {
    const resolvedFetch = fetchFn ?? globalThis.fetch?.bind(globalThis);
    if (resolvedFetch) {
        return resolvedFetch;
    }

    return (() => {
        throw new Error("[ssrRender] loadMessages requires a fetch implementation.");
    }) as typeof globalThis.fetch;
}
