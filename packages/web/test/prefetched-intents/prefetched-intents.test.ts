import { describe, expect, test } from "vite-plus/test";
import { PrefetchedIntents } from "../../src/prefetched-intents/prefetched-intents";

describe("PrefetchedIntents", () => {
    test("creates an empty cache", () => {
        const cache = PrefetchedIntents.empty();

        expect(cache.size).toBe(0);
        expect(cache.has({ id: "missing" })).toBe(false);
        expect(cache.get({ id: "missing" })).toBeUndefined();
    });

    test("stores prefetched data and consumes it once", () => {
        const intent = { id: "home", params: { page: "1" } };
        const cache = PrefetchedIntents.fromArray([
            {
                intent,
                data: { title: "Home" },
            },
        ]);

        expect(cache.has(intent)).toBe(true);
        expect(cache.size).toBe(1);
        expect(cache.get(intent)).toEqual({ title: "Home" });
        expect(cache.has(intent)).toBe(false);
        expect(cache.get(intent)).toBeUndefined();
        expect(cache.size).toBe(0);
    });

    test("uses stable keys and ignores invalid prefetched entries", () => {
        const cache = PrefetchedIntents.fromArray([
            {
                intent: { id: "product", params: { b: "2", a: "1" } },
                data: { ok: true },
            },
            {
                intent: undefined,
                data: "ignored",
            } as never,
            {
                intent: { id: "skip" },
                data: undefined,
            },
        ]);

        const equivalentIntent = { id: "product", params: { a: "1", b: "2" } };

        expect(cache.size).toBe(1);
        expect(cache.has(equivalentIntent)).toBe(true);
        expect(cache.get(equivalentIntent)).toEqual({ ok: true });
    });
});
