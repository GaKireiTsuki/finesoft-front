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
});
