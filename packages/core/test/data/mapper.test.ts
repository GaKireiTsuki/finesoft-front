import { describe, expect, test } from "vite-plus/test";
import { mapEach, pipe, pipeAsync } from "../../src/data/mapper";

describe("mapper helpers", () => {
    test("pipe composes synchronous mappers", () => {
        const mapper = pipe(
            (value: number) => value + 1,
            (value) => value * 2,
            (value) => `result:${value}`,
        );

        expect(mapper(2)).toBe("result:6");
    });

    test("pipeAsync composes sync and async mappers in sequence", async () => {
        const calls: string[] = [];
        const mapper = pipeAsync(
            async (value: number) => {
                calls.push("first");
                return value + 1;
            },
            (value) => {
                calls.push("second");
                return value * 3;
            },
            async (value) => {
                calls.push("third");
                return { total: value };
            },
        );

        await expect(mapper(2)).resolves.toEqual({ total: 9 });
        expect(calls).toEqual(["first", "second", "third"]);
    });

    test("mapEach applies a mapper to every item in an array", () => {
        const mapper = mapEach((value: { id: number; name: string }) => ({
            ...value,
            slug: value.name.toLowerCase(),
        }));

        expect(
            mapper([
                { id: 1, name: "Home" },
                { id: 2, name: "Cart" },
            ]),
        ).toEqual([
            { id: 1, name: "Home", slug: "home" },
            { id: 2, name: "Cart", slug: "cart" },
        ]);
    });
});
