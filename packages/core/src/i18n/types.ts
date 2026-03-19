/**
 * i18n — 类型定义
 *
 * 框架级国际化基础设施。
 */

/** 翻译函数 */
export interface Translator {
    /**
     * 翻译 key → 本地化字符串
     * @param key - 翻译 key
     * @param values - 插值参数
     */
    t(key: string, values?: Record<string, string | number>): string;

    /**
     * 复数形式翻译
     * @param key - 翻译 key 前缀
     * @param count - 数量
     * @param values - 附加插值
     */
    plural(key: string, count: number, values?: Record<string, string | number>): string;

    /** 当前 locale（如 "zh-Hans" / "en-US"） */
    readonly locale: string;
}

/** 文本方向 */
export type TextDirection = "ltr" | "rtl";

/** HTML 语言属性 */
export interface LocaleAttributes {
    /** BCP 47 语言标签 */
    lang: string;
    /** 文本方向 */
    dir: TextDirection;
}

/** Locale 信息 */
export interface LocaleInfo {
    /** 语言代码（如 "zh-Hans", "en"） */
    language: string;
    /** 地区/Storefront 代码（如 "CN", "US"） */
    region?: string;
    /** BCP 47 完整标签 */
    bcp47: string;
    /** 文本方向 */
    dir: TextDirection;
}
