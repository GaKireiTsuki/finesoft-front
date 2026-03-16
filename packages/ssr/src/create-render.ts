/**
 * createSSRRender — 工厂函数，返回可直接被 SSR 服务器调用的 render 函数
 *
 * 将一次性配置（bootstrap / getErrorPage / renderApp）绑定后，
 * 返回 `(url, locale) => Promise<SSRRenderResult>` 签名，
 * 与 @finesoft/server 的 SSRModule 接口对齐。
 */

import type { BasePage, Framework, FrameworkConfig } from "@finesoft/core";
import { ssrRender, type SSRAppResult, type SSRContext, type SSRRenderResult } from "./render";

export interface SSRRenderConfig {
    /** 注册 controllers 和路由的引导函数 */
    bootstrap: (framework: Framework) => void;

    /** 获取错误页面 */
    getErrorPage: (status: number, message: string) => BasePage;

    /**
     * 应用层渲染函数
     *
     * @param page - 当前页面数据
     * @param locale - 当前语言
     * @returns SSR 渲染结果 { html, head, css }
     */
    renderApp: (page: BasePage, locale: string) => SSRAppResult;

    /** Framework 构造配置（可选） */
    frameworkConfig?: FrameworkConfig;
}

/**
 * 创建 render 函数
 *
 * @returns `render(url, locale, ssrContext?)` — 供 @finesoft/server SSRModule 使用
 */
export function createSSRRender(
    config: SSRRenderConfig,
): (url: string, locale: string, ssrContext?: SSRContext) => Promise<SSRRenderResult> {
    const { bootstrap, getErrorPage, renderApp, frameworkConfig } = config;

    return (url: string, locale: string, ssrContext?: SSRContext) =>
        ssrRender({
            url,
            frameworkConfig: frameworkConfig ?? {},
            bootstrap,
            getErrorPage,
            renderApp: (page) => renderApp(page, locale),
            ssrContext,
        });
}
