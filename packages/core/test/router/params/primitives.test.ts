import { describe, expect, test } from "vite-plus/test";
import { bool, int, num, oneOf, str, uuid } from "../../../src/router/params/primitives";
import { runStandard } from "../../../src/router/params/standard";

describe("primitives", () => {
    test("int: parses integers, rejects non-integers and empty", async () => {
        expect(await runStandard(int(), "42")).toEqual({ ok: true, value: 42 });
        expect(await runStandard(int(), "-7")).toEqual({ ok: true, value: -7 });
        expect((await runStandard(int(), "1.5")).ok).toBe(false);
        expect((await runStandard(int(), "abc")).ok).toBe(false);
        expect((await runStandard(int(), "")).ok).toBe(false);
    });

    test("int: enforces min/max", async () => {
        expect((await runStandard(int({ min: 1 }), "0")).ok).toBe(false);
        expect((await runStandard(int({ max: 9 }), "10")).ok).toBe(false);
        expect(await runStandard(int({ min: 1, max: 9 }), "5")).toEqual({ ok: true, value: 5 });
    });

    test("num: parses decimals, rejects junk", async () => {
        expect(await runStandard(num(), "3.14")).toEqual({ ok: true, value: 3.14 });
        expect((await runStandard(num(), "1e3")).ok).toBe(false);
    });

    test("bool: accepts true/false/1/0", async () => {
        expect(await runStandard(bool(), "true")).toEqual({ ok: true, value: true });
        expect(await runStandard(bool(), "0")).toEqual({ ok: true, value: false });
        expect((await runStandard(bool(), "yes")).ok).toBe(false);
    });

    test("oneOf: accepts members, rejects others", async () => {
        const s = oneOf(["asc", "desc"] as const);
        expect(await runStandard(s, "asc")).toEqual({ ok: true, value: "asc" });
        expect((await runStandard(s, "up")).ok).toBe(false);
    });

    test("str: enforces length and pattern", async () => {
        expect(await runStandard(str({ minLength: 1 }), "x")).toEqual({ ok: true, value: "x" });
        expect((await runStandard(str({ minLength: 1 }), "")).ok).toBe(false);
        expect((await runStandard(str({ pattern: /^[a-z]+$/ }), "AB")).ok).toBe(false);
    });

    test("uuid: validates UUID format", async () => {
        expect((await runStandard(uuid(), "550e8400-e29b-41d4-a716-446655440000")).ok).toBe(true);
        expect((await runStandard(uuid(), "not-a-uuid")).ok).toBe(false);
    });
});
