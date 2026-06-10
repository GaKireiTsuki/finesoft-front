import { describe, expect, test } from "vite-plus/test";
import { PrefetchedIntents } from "../../src/prefetched-intents/prefetched-intents";
import { stableStringify } from "../../src/prefetched-intents/stable-stringify";

describe("PrefetchedIntents hydration with codec-converted params", () => {
    // 一个声明了 int() codec 的路由会把 :id 解析成 number。SSR 与 CSR 跑同一份
    // bootstrap，对同一 URL 的两次 resolve 必须产出完全一致的 intent.params，
    // 否则缓存 key（stableStringify(intent)）不匹配、hydration 落空、客户端重新发请求。
    test("number-valued params produce a stable key across SSR and CSR", () => {
        const ssrIntent = { id: "product", params: { id: 42 } };
        const csrIntent = { id: "product", params: { id: 42 } };

        // key 必须一致，CSR 才能复用 SSR 预取的结果
        expect(stableStringify(ssrIntent)).toBe(stableStringify(csrIntent));
    });

    test("a number-keyed prefetched entry is retrievable by an equivalently-resolved intent", () => {
        // SSR 侧：以 number 参数存入预取结果
        const ssrIntent = { id: "product", params: { id: 42 } };
        const cache = PrefetchedIntents.fromArray([
            { intent: ssrIntent, data: { title: "Widget" } },
        ]);

        // CSR 侧：另一个对象身份、但解析结果等价的 intent
        const csrIntent = { id: "product", params: { id: 42 } };

        expect(cache.has(csrIntent)).toBe(true);
        expect(cache.get(csrIntent)).toEqual({ title: "Widget" });
        // 一次性消费后即失效
        expect(cache.has(csrIntent)).toBe(false);
    });

    test("a number param does not collide with the same value as a string", () => {
        // number 42 与 string "42" 必须产生不同的 key，避免误命中
        const numberIntent = { id: "product", params: { id: 42 } };
        const stringIntent = { id: "product", params: { id: "42" } };

        const cache = PrefetchedIntents.fromArray([
            { intent: numberIntent, data: { kind: "number" } },
        ]);

        expect(cache.has(stringIntent)).toBe(false);
        expect(cache.has(numberIntent)).toBe(true);
    });
});
