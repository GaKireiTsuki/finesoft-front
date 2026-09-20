import { describe, expect, test } from "vite-plus/test";
import { bool, int, num, oneOf, str, uuid } from "../../src/schema/primitives";

describe("primitives", () => {
    test("int: parses integers, rejects non-integers and empty", async () => {
        expect(await int()["~standard"].validate("42")).toEqual({ value: 42 });
        expect(await int()["~standard"].validate("-7")).toEqual({ value: -7 });
        expect((await int()["~standard"].validate("1.5")).issues).toBeDefined();
        expect((await int()["~standard"].validate("abc")).issues).toBeDefined();
        expect((await int()["~standard"].validate("")).issues).toBeDefined();
    });

    test("int: enforces min/max", async () => {
        expect((await int({ min: 1 })["~standard"].validate("0")).issues).toBeDefined();
        expect((await int({ max: 9 })["~standard"].validate("10")).issues).toBeDefined();
        expect(await int({ min: 1, max: 9 })["~standard"].validate("5")).toEqual({ value: 5 });
    });

    test("int/num: min and max boundaries are inclusive", async () => {
        expect(await int({ min: 1 })["~standard"].validate("1")).toEqual({ value: 1 });
        expect(await int({ max: 9 })["~standard"].validate("9")).toEqual({ value: 9 });
        expect(await num({ min: 1.5 })["~standard"].validate("1.5")).toEqual({ value: 1.5 });
    });

    test("num: parses decimals, rejects junk", async () => {
        expect(await num()["~standard"].validate("3.14")).toEqual({ value: 3.14 });
        expect((await num()["~standard"].validate("1e3")).issues).toBeDefined();
    });

    test("bool: accepts true/false/1/0", async () => {
        expect(await bool()["~standard"].validate("true")).toEqual({ value: true });
        expect(await bool()["~standard"].validate("0")).toEqual({ value: false });
        expect((await bool()["~standard"].validate("yes")).issues).toBeDefined();
    });

    test("oneOf: accepts members, rejects others", async () => {
        const s = oneOf(["asc", "desc"] as const);
        expect(await s["~standard"].validate("asc")).toEqual({ value: "asc" });
        expect((await s["~standard"].validate("up")).issues).toBeDefined();
    });

    test("str: enforces length and pattern", async () => {
        expect(await str({ minLength: 1 })["~standard"].validate("x")).toEqual({ value: "x" });
        expect((await str({ minLength: 1 })["~standard"].validate("")).issues).toBeDefined();
        expect(
            (await str({ pattern: /^[a-z]+$/ })["~standard"].validate("AB")).issues,
        ).toBeDefined();
    });

    test("uuid: validates UUID format", async () => {
        expect(
            (await uuid()["~standard"].validate("550e8400-e29b-41d4-a716-446655440000")).issues,
        ).toBeUndefined();
        expect((await uuid()["~standard"].validate("not-a-uuid")).issues).toBeDefined();
    });
});
