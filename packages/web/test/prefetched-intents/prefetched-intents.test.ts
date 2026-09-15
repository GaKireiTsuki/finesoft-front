import { describe, expect, test } from "vite-plus/test";
import { PrefetchedIntents } from "../../src/prefetched-intents/prefetched-intents";

describe("PrefetchedIntents", () => {
    test("creates an empty cache", () => {
        const cache = PrefetchedIntents.empty();

        expect(cache.size).toBe(0);
        expect(cache.has({ id: "missing" }, "entry-a")).toBe(false);
        expect(cache.get({ id: "missing" }, "entry-a")).toBeUndefined();
    });

    test("stores prefetched data and consumes it once", () => {
        const intent = { id: "home", params: { page: "1" } };
        const cache = PrefetchedIntents.fromArray([
            { entryId: "entry-a", intent, data: { title: "Home" } },
        ]);

        expect(cache.has(intent, "entry-a")).toBe(true);
        expect(cache.size).toBe(1);
        expect(cache.get(intent, "entry-a")).toEqual({ title: "Home" });
        expect(cache.has(intent, "entry-a")).toBe(false);
        expect(cache.get(intent, "entry-a")).toBeUndefined();
        expect(cache.size).toBe(0);
    });

    test("uses stable keys and ignores invalid prefetched entries", () => {
        const cache = PrefetchedIntents.fromArray([
            {
                entryId: "entry-a",
                intent: { id: "product", params: { b: "2", a: "1" } },
                data: { ok: true },
            },
            {
                intent: undefined,
                data: "ignored",
            } as never,
            { entryId: "entry-a", intent: { id: "skip" }, data: undefined },
        ]);

        const equivalentIntent = { id: "product", params: { a: "1", b: "2" } };

        expect(cache.size).toBe(1);
        expect(cache.has(equivalentIntent, "entry-a")).toBe(true);
        expect(cache.get(equivalentIntent, "entry-a")).toEqual({ ok: true });
    });
});
