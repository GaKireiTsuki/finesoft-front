import { describe, expect, test } from "vite-plus/test";
import { makeSchema, type ParamSchema } from "../../src/schema/standard";

describe("Standard Schema", () => {
    const upper: ParamSchema<string> = makeSchema<string>((v) =>
        typeof v === "string" ? { value: v.toUpperCase() } : { issues: [{ message: "no" }] },
    );

    test("runs a sync schema and returns the transformed value", async () => {
        const r = await upper["~standard"].validate("abc");
        expect(r).toEqual({ value: "ABC" });
    });

    test("reports issues on failure", async () => {
        const r = await upper["~standard"].validate(undefined);
        expect(r).toEqual({ issues: [{ message: "no" }] });
    });

    test("awaits an async schema", async () => {
        const asyncUpper: ParamSchema<string> = makeSchema<string>(async (v) => ({
            value: String(v).toUpperCase(),
        }));
        const r = await asyncUpper["~standard"].validate("abc");
        expect(r).toEqual({ value: "ABC" });
    });
});
