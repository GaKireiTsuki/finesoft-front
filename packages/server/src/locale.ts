/**
 * Accept-Language 解析
 */

/** Accept-Language 头最大长度 */
const MAX_HEADER_LENGTH = 1024;
/** 最大解析语言条目数 */
const MAX_LANG_ENTRIES = 50;

export function parseAcceptLanguage(
    header: string | undefined,
    supported?: string[],
    fallback?: string,
): string {
    const effectiveSupported = supported ?? ["zh", "en"];
    const effectiveFallback = fallback ?? effectiveSupported[0] ?? "en";
    if (!header || header.length > MAX_HEADER_LENGTH) return effectiveFallback;
    const parts = header.split(",");
    if (parts.length > MAX_LANG_ENTRIES) return effectiveFallback;
    const langs = parts
        .map((part) => {
            const [lang, q] = part.trim().split(";q=");
            const qVal = q ? parseFloat(q) : 1;
            return {
                lang: lang.trim().toLowerCase(),
                q: Number.isFinite(qVal) && qVal >= 0 && qVal <= 1 ? qVal : 0,
            };
        })
        .sort((a, b) => b.q - a.q);

    for (const { lang } of langs) {
        const prefix = lang.split("-")[0];
        if (effectiveSupported.includes(prefix)) {
            return prefix;
        }
    }
    return effectiveFallback;
}
