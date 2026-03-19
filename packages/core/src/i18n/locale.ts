/**
 * Locale 工具 — RTL 检测、BCP47 格式化、HTML 属性生成
 */

import type { LocaleAttributes, LocaleInfo, TextDirection } from "./types";

/** RTL 语言列表 */
const RTL_LANGUAGES = new Set([
    "ar",
    "arc",
    "dv",
    "fa",
    "ha",
    "he",
    "khw",
    "ks",
    "ku",
    "ps",
    "ur",
    "yi",
]);

/** 检测语言是否为 RTL */
export function isRtl(language: string): boolean {
    const primary = language.split("-")[0].toLowerCase();
    return RTL_LANGUAGES.has(primary);
}

/** 获取文本方向 */
export function getTextDirection(language: string): TextDirection {
    return isRtl(language) ? "rtl" : "ltr";
}

/**
 * 从语言代码生成 HTML lang/dir 属性
 *
 * @example
 * ```ts
 * getLocaleAttributes("ar-SA") // { lang: "ar-SA", dir: "rtl" }
 * getLocaleAttributes("en-US") // { lang: "en-US", dir: "ltr" }
 * ```
 */
export function getLocaleAttributes(language: string): LocaleAttributes {
    return {
        lang: language,
        dir: getTextDirection(language),
    };
}

/**
 * 构建 LocaleInfo
 *
 * @param language - 语言代码（如 "zh-Hans"）
 * @param region - 地区代码（如 "CN"），可选
 */
export function makeLocaleInfo(language: string, region?: string): LocaleInfo {
    const bcp47 = region ? `${language}-${region}` : language;
    return {
        language,
        region,
        bcp47,
        dir: getTextDirection(language),
    };
}

/**
 * 将 locale 属性应用到 `<html>` 元素
 *
 * 服务端渲染时可用于字符串拼接，浏览器端直接操作 DOM。
 */
export function setHtmlLocaleAttributes(attrs: LocaleAttributes): void {
    document.documentElement.lang = attrs.lang;
    document.documentElement.dir = attrs.dir;
}

/**
 * 从 URL 前缀中提取 locale
 *
 * @param url - 请求 URL（如 "/zh/about"）
 * @param supportedLocales - 支持的 locale 列表（如 ["zh", "en", "ja"]）
 * @returns 匹配时返回 `{ locale, strippedUrl }`，不匹配返回 null
 *
 * @example
 * ```ts
 * resolveLocaleFromUrl("/zh/about", ["zh", "en"])
 * // → { locale: "zh", strippedUrl: "/about" }
 *
 * resolveLocaleFromUrl("/about", ["zh", "en"])
 * // → null
 * ```
 */
export function resolveLocaleFromUrl(
    url: string,
    supportedLocales: string[],
): { locale: string; strippedUrl: string } | null {
    const path = url.split("?")[0];
    const match = path.match(/^\/([^/]+)(\/.*)?$/);
    if (!match) return null;

    const candidate = match[1];
    const found = supportedLocales.find((l) => l.toLowerCase() === candidate.toLowerCase());
    if (!found) return null;

    return {
        locale: found,
        strippedUrl: match[2] || "/",
    };
}
