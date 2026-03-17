/**
 * ssrRender — 通用 SSR 渲染管线
 *
 * 1. 创建 Framework + 注册 Controllers
 * 2. routeUrl → Intent
 * 3. dispatch → Page 数据
 * 4. 调用应用层提供的渲染函数
 */

import {
    Framework,
    createServerContext,
    type BasePage,
    type FrameworkConfig,
    type MiddlewareResult,
    type PostLoadContext,
    type PrefetchedIntent,
} from "@finesoft/core";

export interface SSRRenderOptions {
    /** 请求 URL */
    url: string;
    /** Framework 配置（含路由注册等） */
    frameworkConfig: FrameworkConfig;
    /** 注册 controllers 和路由的引导函数 */
    bootstrap: (framework: Framework) => void;
    /** 获取错误页面 */
    getErrorPage: (status: number, message: string) => BasePage;
    /** 应用层渲染函数（如 Svelte SSR render / Vue renderToString） */
    renderApp: (page: BasePage, framework: Framework) => SSRAppResult | Promise<SSRAppResult>;
    /** 可选的 SSR 请求上下文（如自定义 fetch） */
    ssrContext?: SSRContext;
}

/** SSR 请求级上下文 */
export interface SSRContext {
    /** 自定义 fetch（如 Hono 内部路由回环） */
    fetch?: typeof globalThis.fetch;
    /** 原始 Request 对象（用于中间件读取 cookie/header） */
    request?: Request;
}

export interface SSRAppResult {
    html: string;
    head: string;
    css: string;
    /** 自定义 slot 替换：`{ "my-slot": "<div>...</div>" }` 对应 HTML 中的 `<!--ssr-my-slot-->` */
    slots?: Record<string, string>;
}

export interface SSRRenderResult {
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
}

export async function ssrRender(options: SSRRenderOptions): Promise<SSRRenderResult> {
    const { url, frameworkConfig, bootstrap, getErrorPage, renderApp, ssrContext } = options;

    // 将 SSR 上下文中的 fetch 合并到 frameworkConfig，注入 DI 容器
    const mergedConfig: FrameworkConfig = ssrContext?.fetch
        ? { ...frameworkConfig, fetch: ssrContext.fetch }
        : frameworkConfig;

    const framework = Framework.create(mergedConfig);
    bootstrap(framework);

    try {
        const parsed = new URL(url, "http://localhost");
        const fullPath = parsed.pathname + parsed.search;
        const match = framework.routeUrl(fullPath);

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

        let page: BasePage;
        let serverData: PrefetchedIntent[] = [];

        if (match) {
            // ===== beforeLoad 中间件 =====
            const navCtx = createServerContext({
                url: fullPath,
                intent: match.intent,
                container: framework.container,
                request: ssrContext?.request,
            });
            const beforeResult = await framework.runBeforeLoad(navCtx, match.beforeGuards);
            if (beforeResult.kind !== "next") {
                const earlyReturn = await handleMiddlewareResult(
                    beforeResult,
                    getErrorPage,
                    renderApp,
                    framework,
                );
                if (earlyReturn) return earlyReturn;
            }

            try {
                page = (await framework.dispatch(match.intent)) as BasePage;
                serverData = [{ intent: match.intent, data: page }];
            } catch (e) {
                console.error(`[SSR] dispatch failed for intent "${match.intent.id}":`, e);
                page = getErrorPage(500, "Internal error");
            }

            // ===== afterLoad 中间件 =====
            const postCtx: PostLoadContext = {
                ...navCtx,
                page,
            };
            const afterResult = await framework.runAfterLoad(postCtx, match.afterGuards);
            if (afterResult.kind !== "next") {
                const lateReturn = await handleMiddlewareResult(
                    afterResult,
                    getErrorPage,
                    renderApp,
                    framework,
                );
                if (lateReturn) return lateReturn;
            }
        } else {
            page = getErrorPage(404, "Page not found");
        }

        const result = await renderApp(page, framework);

        return {
            html: result.html,
            head: result.head,
            css: result.css,
            serverData,
            renderMode: match?.renderMode,
            slots: result.slots,
        };
    } finally {
        framework.dispose();
    }
}

/**
 * 将中间件结果转换为 SSRRenderResult（如果需要短路返回）。
 * 返回 null 表示继续正常流程。
 */
async function handleMiddlewareResult(
    result: MiddlewareResult,
    getErrorPage: (status: number, message: string) => BasePage,
    renderApp: (page: BasePage, framework: Framework) => SSRAppResult | Promise<SSRAppResult>,
    framework: Framework,
): Promise<SSRRenderResult | null> {
    switch (result.kind) {
        case "next":
            return null;
        case "redirect":
            return {
                html: "",
                head: "",
                css: "",
                serverData: [],
                redirect: { url: result.url, status: result.status },
            };
        case "rewrite":
            return {
                html: "",
                head: "",
                css: "",
                serverData: [],
                redirect: { url: result.url, status: 301 },
            };
        case "deny": {
            const errorPage = getErrorPage(result.status, result.message);
            const rendered = await renderApp(errorPage, framework);
            return {
                html: rendered.html,
                head: rendered.head,
                css: rendered.css,
                serverData: [],
                slots: rendered.slots,
            };
        }
    }
}
