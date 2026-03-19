/**
 * SimpleTranslator — 默认翻译器实现
 *
 * 从扁平的 key→string 映射提供翻译，支持 ICU 插值和复数规则。
 */

import {
    englishPlural,
    interpolate,
    resolvePluralKey,
    type PluralRuleProvider,
} from "./interpolate";
import type { Translator } from "./types";

export interface SimpleTranslatorOptions {
    /** 翻译映射 */
    messages: Record<string, string>;
    /** 当前 locale */
    locale: string;
    /** 复数规则函数（默认英语规则） */
    pluralRule?: PluralRuleProvider;
    /** 找不到翻译时的回退行为（默认返回 key） */
    fallback?: (key: string) => string;
}

export class SimpleTranslator implements Translator {
    readonly locale: string;
    private readonly messages: Record<string, string>;
    private readonly pluralRule: PluralRuleProvider;
    private readonly fallback: (key: string) => string;

    constructor(options: SimpleTranslatorOptions) {
        this.locale = options.locale;
        this.messages = options.messages;
        this.pluralRule = options.pluralRule ?? englishPlural;
        this.fallback = options.fallback ?? ((key) => key);
    }

    t(key: string, values?: Record<string, string | number>): string {
        const template = this.messages[key];
        if (template === undefined) {
            return this.fallback(key);
        }
        return interpolate(template, values);
    }

    plural(key: string, count: number, values?: Record<string, string | number>): string {
        const category = this.pluralRule(count);
        const pluralKey = resolvePluralKey(key, category);
        const mergedValues = { count, ...values };
        return this.t(pluralKey, mergedValues);
    }
}
