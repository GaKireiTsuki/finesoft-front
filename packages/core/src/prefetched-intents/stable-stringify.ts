/**
 * stableStringify — 确定性 JSON 序列化（keys 按字母排序）
 *
 * 用作缓存 key：相同内容的对象始终产生相同字符串。
 */

/** WeakMap 缓存已序列化的对象，避免重复计算 */
const stringifyCache = new WeakMap<object, string>();

/** 最大递归深度 */
const MAX_DEPTH = 50;

export function stableStringify(obj: unknown, _seen?: Set<object>, _depth?: number): string {
    if (obj === null || obj === undefined) return String(obj);
    if (typeof obj !== "object") return JSON.stringify(obj);

    const cached = stringifyCache.get(obj as object);
    if (cached !== undefined) return cached;

    const depth = _depth ?? 0;
    if (depth > MAX_DEPTH) return '"[Max Depth]"';

    const seen = _seen ?? new Set<object>();
    if (seen.has(obj as object)) return '"[Circular]"';
    seen.add(obj as object);

    let result: string;
    if (Array.isArray(obj)) {
        result = "[" + obj.map((v) => stableStringify(v, seen, depth + 1)).join(",") + "]";
    } else {
        const keys = Object.keys(obj as Record<string, unknown>).sort();
        const parts: string[] = [];
        for (const k of keys) {
            const v = (obj as Record<string, unknown>)[k];
            if (v !== undefined) {
                parts.push(JSON.stringify(k) + ":" + stableStringify(v, seen, depth + 1));
            }
        }
        result = "{" + parts.join(",") + "}";
    }

    stringifyCache.set(obj as object, result);
    return result;
}
