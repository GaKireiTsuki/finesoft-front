/**
 * ICU 消息格式插值
 *
 * 支持 `{name}` 占位符替换和基础复数规则。
 */

/** 将 `{key}` 占位符替换为 values 中的对应值 */
export function interpolate(template: string, values?: Record<string, string | number>): string {
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (_, key: string) => {
        const val = values[key];
        return val !== undefined ? String(val) : `{${key}}`;
    });
}

/**
 * CLDR 复数类别
 *
 * 简化版：覆盖 zero / one / two / few / many / other。
 * 完整 CLDR 规则可通过 PluralRuleProvider 注入。
 */
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

/** 复数规则函数 — 给定数量返回复数类别 */
export type PluralRuleProvider = (count: number) => PluralCategory;

/**
 * 英语复数规则（默认）
 * 0 → other, 1 → one, 2+ → other
 */
export function englishPlural(count: number): PluralCategory {
    return count === 1 ? "one" : "other";
}

/**
 * 解析带复数后缀的翻译 key
 *
 * 约定: `key.one`, `key.other`, `key.zero`, etc.
 */
export function resolvePluralKey(key: string, category: PluralCategory): string {
    return `${key}.${category}`;
}
