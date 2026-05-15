// vitepress 用 markdown-it-async (MarkdownItAsync)，与 markdown-it 的 MarkdownIt 类型不兼容；
// 这里只用 token-level renderer rules 接口，对两者通用，所以放宽到结构性类型。
type MdLike = {
    renderer: {
        rules: Record<
            string,
            ((tokens: any[], idx: number, options: any, env: any, self: any) => string) | undefined
        >;
    };
};

const README_RE = /(^|\/)README(\.md)?(#|$)/i;
const TRAILING_MD = /\.md(#|$)/i;

function rewriteHref(href: string): string {
    if (!href || /^([a-z]+:)?\/\//i.test(href) || href.startsWith("mailto:")) return href;
    if (README_RE.test(href)) {
        return href.replace(
            README_RE,
            (_, prefix, _md, suffix) => `${prefix}${suffix === "#" ? "#" : ""}`,
        );
    }
    if (TRAILING_MD.test(href)) {
        return href.replace(TRAILING_MD, (_, suffix) => (suffix === "#" ? "#" : ""));
    }
    return href;
}

export function rewriteLinks(md: MdLike): void {
    const defaultRender =
        md.renderer.rules.link_open ??
        ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

    md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const hrefIndex = token.attrIndex("href");
        if (hrefIndex >= 0) {
            const original = token.attrs[hrefIndex][1];
            token.attrs[hrefIndex][1] = rewriteHref(original);
        }
        return defaultRender(tokens, idx, options, env, self);
    };
}
