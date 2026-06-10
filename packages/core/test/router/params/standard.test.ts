import { describe, expect, test } from "vite-plus/test";
import { makeSchema, runStandard, type ParamSchema } from "../../../src/router/params/standard";

describe("makeSchema / runStandard", () => {
    const upper: ParamSchema<string> = makeSchema<string>((v) =>
        typeof v === "string" ? { value: v.toUpperCase() } : { issues: [{ message: "no" }] },
    );

    test("runs a sync schema and returns the transformed value", async () => {
        const r = await runStandard(upper, "abc");
        expect(r).toEqual({ ok: true, value: "ABC" });
    });

    test("reports issues on failure", async () => {
        const r = await runStandard(upper, undefined);
        expect(r).toEqual({ ok: false, issues: [{ message: "no" }] });
    });

    test("awaits an async schema", async () => {
        const asyncUpper: ParamSchema<string> = makeSchema<string>(async (v) => ({
            value: String(v).toUpperCase(),
        }));
        const r = await runStandard(asyncUpper, "abc");
        expect(r).toEqual({ ok: true, value: "ABC" });
    });
});
