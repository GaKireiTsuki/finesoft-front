import { describe, expect, test } from "vite-plus/test";
import { list } from "../../../src/router/params/multi";
import { int, str } from "../../../src/router/params/primitives";
import { runStandard } from "../../../src/router/params/standard";

describe("list (multi-value query codec)", () => {
    test("validates each item with the inner codec and converts", async () => {
        expect(await runStandard(list(str()), ["a", "b"])).toEqual({ ok: true, value: ["a", "b"] });
        expect(await runStandard(list(int()), ["1", "2"])).toEqual({ ok: true, value: [1, 2] });
    });

    test("rejects when any item fails the inner codec", async () => {
        expect((await runStandard(list(int()), ["1", "x"])).ok).toBe(false);
    });

    test("absent (undefined) yields an empty array", async () => {
        expect(await runStandard(list(str()), undefined)).toEqual({ ok: true, value: [] });
    });

    test("enforces min/max item count", async () => {
        expect((await runStandard(list(str(), { min: 1 }), [])).ok).toBe(false);
        expect((await runStandard(list(str(), { max: 1 }), ["a", "b"])).ok).toBe(false);
        expect(await runStandard(list(str(), { min: 1, max: 2 }), ["a"])).toEqual({
            ok: true,
            value: ["a"],
        });
    });
});
