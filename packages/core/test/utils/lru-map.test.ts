import { describe, expect, test } from "vite-plus/test";
import { LruMap } from "../../src/utils/lru-map";

describe("LruMap", () => {
    test("requires a positive capacity", () => {
        expect(() => new LruMap(0)).toThrow(/capacity must be >= 1/);
    });

    test("evicts the least recently used item", () => {
        const cache = new LruMap<string, number>(2);

        cache.set("a", 1);
        cache.set("b", 2);
        expect(cache.get("a")).toBe(1);

        cache.set("c", 3);

        expect(cache.has("a")).toBe(true);
        expect(cache.has("b")).toBe(false);
        expect(cache.has("c")).toBe(true);
    });

    test("updates existing keys without growing the cache", () => {
        const cache = new LruMap<string, number>(2);

        cache.set("a", 1);
        cache.set("a", 2);

        expect(cache.size).toBe(1);
        expect(cache.get("a")).toBe(2);
    });

    test("supports delete and clear", () => {
        const cache = new LruMap<string, number>(2);

        cache.set("a", 1);
        cache.set("b", 2);

        expect(cache.delete("a")).toBe(true);
        expect(cache.size).toBe(1);

        cache.clear();

        expect(cache.size).toBe(0);
    });
});
