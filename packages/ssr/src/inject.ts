/**
 * injectSSRContent — 将 SSR 渲染结果注入 HTML 模板
 */

/** SSR HTML 模板占位符常量 */
export const SSR_PLACEHOLDERS = {
    HEAD: "<!--ssr-head-->",
    BODY: "<!--ssr-body-->",
    DATA: "<!--ssr-data-->",
} as const;

export interface InjectSSROptions {
    template: string;
    head: string;
    css: string;
    html: string;
    serializedData: string;
    /** 自定义 slot 替换：`{ "my-slot": "<div>content</div>" }` 会替换 `<!--ssr-my-slot-->`（含 `<!--ssr-lang-->`） */
    slots?: Record<string, string>;
    /** Locale 属性，自动注入到 <html> 标签 */
    locale?: { lang: string; dir: string };
}

/** 匹配所有 <!--ssr-xxx--> 占位符（含内置与自定义） */
const PLACEHOLDER_REGEX = /<!--ssr-([a-z][a-z0-9-]*)-->/g;

export function injectSSRContent(options: InjectSSROptions): string {
    const { template, head, css, html, serializedData, slots, locale } = options;
    const cssTag = css ? `<style>${css}</style>` : "";

    const replacements: Record<string, string> = {
        head: `${head}\n${cssTag}`,
        body: html,
        data: `<script id="serialized-server-data" type="application/json">${serializedData}</script>`,
        ...slots,
    };

    let result = template.replace(PLACEHOLDER_REGEX, (_, name: string) => replacements[name] ?? "");

    // Inject lang/dir into <html> tag
    if (locale) {
        result = result.replace(
            /(<html)([^>]*)(>)/i,
            (match, open: string, attrs: string, close: string) => {
                // Remove existing lang/dir attributes to avoid duplicates
                let cleaned = attrs
                    .replace(/\s+lang="[^"]*"/gi, "")
                    .replace(/\s+dir="[^"]*"/gi, "");
                return `${open}${cleaned} lang="${locale.lang}" dir="${locale.dir}"${close}`;
            },
        );
    }

    return result;
}

/**
 * CSR 空壳注入 — 清空所有占位符
 * 用于 renderMode === "csr" 的路由
 */
export function injectCSRShell(template: string): string {
    return template.replace(PLACEHOLDER_REGEX, () => "");
}
