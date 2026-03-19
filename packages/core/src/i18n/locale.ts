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
