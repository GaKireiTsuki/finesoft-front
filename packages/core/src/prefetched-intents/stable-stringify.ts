/**
 * stableStringify — 确定性 JSON 序列化（keys 按字母排序）
 *
 * 用作缓存 key：相同内容的对象始终产生相同字符串。
 */

export function stableStringify(obj: unknown, _seen?: Set<object>): string {
    if (obj === null || obj === undefined) return String(obj);
    if (typeof obj !== "object") return JSON.stringify(obj);

    const seen = _seen ?? new Set<object>();
    if (seen.has(obj as object)) return '"[Circular]"';
    seen.add(obj as object);

    if (Array.isArray(obj)) {
        return "[" + obj.map((v) => stableStringify(v, seen)).join(",") + "]";
    }
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const parts = keys
        .filter((k) => (obj as Record<string, unknown>)[k] !== undefined)
        .map(
            (k) =>
                JSON.stringify(k) +
                ":" +
                stableStringify((obj as Record<string, unknown>)[k], seen),
        );
    return "{" + parts.join(",") + "}";
}
