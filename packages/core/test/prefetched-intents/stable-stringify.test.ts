import { describe, expect, test } from "vite-plus/test";
import { stableStringify } from "../../src/prefetched-intents/stable-stringify";

describe("stableStringify", () => {
    test("sorts object keys deterministically", () => {
        expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
        expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    });

    test("omits undefined values and serializes nested arrays", () => {
        expect(
            stableStringify({
                title: "test",
                skip: undefined,
                nested: [1, { ok: true }],
            }),
        ).toBe('{"nested":[1,{"ok":true}],"title":"test"}');
    });

    test("marks circular references", () => {
        const value: { name: string; self?: unknown } = { name: "root" };
        value.self = value;

        expect(stableStringify(value)).toBe('{"name":"root","self":"[Circular]"}');
    });

    test("stops traversing after the maximum depth", () => {
        let value: Record<string, unknown> = {};
        const root = value;

        for (let i = 0; i < 55; i++) {
            value.child = {};
            value = value.child as Record<string, unknown>;
        }

        expect(stableStringify(root)).toContain('"[Max Depth]"');
    });

    test("serializes DAG with shared subtree without false circular markers", () => {
        // 同一对象在两个属性中出现（DAG，非 cycle）—— 不应被标记为 [Circular]
        const shared = { value: 42 };
        const root = { a: shared, b: shared };

        const result = stableStringify(root);
        expect(result).toBe('{"a":{"value":42},"b":{"value":42}}');
        expect(result).not.toContain("[Circular]");
    });
});
