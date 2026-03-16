/**
 * injectSSRContent — 将 SSR 渲染结果注入 HTML 模板
 */

/** SSR HTML 模板占位符常量 */
export const SSR_PLACEHOLDERS = {
    LANG: "<!--ssr-lang-->",
    HEAD: "<!--ssr-head-->",
    BODY: "<!--ssr-body-->",
    DATA: "<!--ssr-data-->",
} as const;

export interface InjectSSROptions {
    template: string;
    locale: string;
    head: string;
    css: string;
    html: string;
    serializedData: string;
}

export function injectSSRContent(options: InjectSSROptions): string {
    const { template, locale, head, css, html, serializedData } = options;
    const cssTag = css ? `<style>${css}</style>` : "";

    return template
        .replace(SSR_PLACEHOLDERS.LANG, locale)
        .replace(SSR_PLACEHOLDERS.HEAD, `${head}\n${cssTag}`)
        .replace(SSR_PLACEHOLDERS.BODY, html)
        .replace(
            SSR_PLACEHOLDERS.DATA,
            `<script id="serialized-server-data" type="application/json">${serializedData}</script>`,
        );
}

/**
 * CSR 空壳注入 — 只替换 lang，清空 body/head/data 占位符
 * 用于 renderMode === "csr" 的路由
 */
export function injectCSRShell(template: string, locale: string): string {
    return template
        .replace(SSR_PLACEHOLDERS.LANG, locale)
        .replace(SSR_PLACEHOLDERS.HEAD, "")
        .replace(SSR_PLACEHOLDERS.BODY, "")
        .replace(SSR_PLACEHOLDERS.DATA, "");
}
