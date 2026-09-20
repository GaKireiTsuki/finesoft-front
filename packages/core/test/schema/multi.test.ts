import { describe, expect, test } from "vite-plus/test";
import { list } from "../../src/schema/multi";
import { int, str } from "../../src/schema/primitives";

describe("list (multi-value query codec)", () => {
    test("validates each item with the inner codec and converts", async () => {
        expect(await list(str())["~standard"].validate(["a", "b"])).toEqual({ value: ["a", "b"] });
        expect(await list(int())["~standard"].validate(["1", "2"])).toEqual({ value: [1, 2] });
    });

    test("rejects when any item fails the inner codec", async () => {
        expect((await list(int())["~standard"].validate(["1", "x"])).issues).toBeDefined();
    });

    test("absent (undefined) yields an empty array", async () => {
        expect(await list(str())["~standard"].validate(undefined)).toEqual({ value: [] });
    });

    test("enforces min/max item count", async () => {
        expect((await list(str(), { min: 1 })["~standard"].validate([])).issues).toBeDefined();
        expect(
            (await list(str(), { max: 1 })["~standard"].validate(["a", "b"])).issues,
        ).toBeDefined();
        expect(await list(str(), { min: 1, max: 2 })["~standard"].validate(["a"])).toEqual({
            value: ["a"],
        });
    });
});
