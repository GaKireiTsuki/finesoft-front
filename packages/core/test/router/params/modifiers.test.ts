import { describe, expect, test } from "vite-plus/test";
import { int } from "../../../src/router/params/primitives";
import { optional, withDefault } from "../../../src/router/params/modifiers";
import { runStandard } from "../../../src/router/params/standard";

describe("modifiers", () => {
    test("optional: undefined input yields undefined value, no validation", async () => {
        expect(await runStandard(optional(int()), undefined)).toEqual({
            ok: true,
            value: undefined,
        });
    });

    test("optional: present input is delegated to inner codec", async () => {
        expect(await runStandard(optional(int()), "5")).toEqual({ ok: true, value: 5 });
        expect((await runStandard(optional(int()), "x")).ok).toBe(false);
    });

    test("withDefault: undefined input yields fallback", async () => {
        expect(await runStandard(withDefault(int(), 1), undefined)).toEqual({ ok: true, value: 1 });
    });

    test("withDefault: present input is delegated", async () => {
        expect(await runStandard(withDefault(int(), 1), "9")).toEqual({ ok: true, value: 9 });
    });
});
