import { ownRender } from "./render-owner";
/**
 * createSSRRender — 工厂函数，返回可直接被 SSR 服务器调用的 render 函数
 *
 * 将一次性配置（definition / getErrorPage / renderApp）绑定后，
 * 返回 `(url, ssrContext?) => Promise<SSRRenderResult>` 签名，
 * 与 @finesoft/server 的 SSRModule 接口对齐。
 */

import { Framework, type BasePage, type WebAppDefinition } from "@finesoft/web";
import type { FrameworkConfig, MessagesLoader } from "@finesoft/web";
import { ssrRender, type SSRAppResult, type SSRContext, type SSRRenderResult } from "./render";

export interface SSRRenderConfig {
    /** Reusable page, route and policy declarations. */
    definition: WebAppDefinition;

    /** 获取错误页面 */
    getErrorPage?: (status: number, message: string) => BasePage;

    /**
     * 应用层渲染函数
     *
     * @param page - 当前页面数据
     * @param framework - Framework 实例（可用于获取 translator、locale 等）
     * @returns SSR 渲染结果 { html, head, css, slots? }
     */
    renderApp: (page: BasePage, framework: Framework) => SSRAppResult | Promise<SSRAppResult>;

    /** Framework 构造配置（可选） */
    frameworkConfig?: Omit<FrameworkConfig, "definition">;

    /** 解析请求 locale 的回调（返回 lang + dir 用于 <html> 属性） */
    resolveLocale?: (url: string, request?: Request) => { lang: string; dir: string } | undefined;

    /** 异步加载当前 locale 的翻译字典 */
    loadMessages?: MessagesLoader;
}

/**
 * 创建 render 函数
 *
 * @returns `render(url, ssrContext?)` — 供 @finesoft/server SSRModule 使用
 */
export function createSSRRender(config: SSRRenderConfig): ((
    url: string,
    ssrContext?: SSRContext,
) => Promise<SSRRenderResult>) & {
    dispose(): Promise<void>;
    readonly routes: WebAppDefinition["routes"];
} {
    const { getErrorPage, renderApp, frameworkConfig, resolveLocale, loadMessages } = config;

    const owner = Framework.create({ ...frameworkConfig, definition: config.definition });
    const render = (url: string, ssrContext?: SSRContext) =>
        ssrRender({
            url,
            frameworkConfig: {
                ...frameworkConfig,
                definition: config.definition,
                runtime: owner.runtime,
            },
            getErrorPage:
                getErrorPage ??
                config.definition?.getErrorPage ??
                ((status, message) => ({ id: String(status), pageType: "error", title: message })),
            renderApp: (page, framework) => renderApp(page, framework),
            ssrContext,
            resolveLocale,
            loadMessages,
        });
    return Object.assign(
        ownRender(render, () => owner.dispose()),
        { routes: config.definition.routes },
    );
}
