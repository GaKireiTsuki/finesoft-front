import { describe, expect, test } from "vite-plus/test";
import { int } from "../../src/schema/primitives";
import { optional, withDefault } from "../../src/schema/modifiers";
import { isMultiValueSchema, list } from "../../src/schema/multi";

describe("modifiers", () => {
    test("optional: undefined input yields undefined value, no validation", async () => {
        expect(await optional(int())["~standard"].validate(undefined)).toEqual({
            value: undefined,
        });
    });

    test("optional: present input is delegated to inner codec", async () => {
        expect(await optional(int())["~standard"].validate("5")).toEqual({ value: 5 });
        expect((await optional(int())["~standard"].validate("x")).issues).toBeDefined();
    });

    test("withDefault: undefined input yields fallback", async () => {
        expect(await withDefault(int(), 1)["~standard"].validate(undefined)).toEqual({ value: 1 });
    });

    test("withDefault: present input is delegated", async () => {
        expect(await withDefault(int(), 1)["~standard"].validate("9")).toEqual({ value: 9 });
    });

    test("multi-value modifiers retain repeated keys and distinguish missing from invalid", async () => {
        const optionalIds = optional(list(int(), { min: 1 }));
        const defaultIds = withDefault(list(int()), [7]);
        for (const schema of [optionalIds, defaultIds]) {
            expect(isMultiValueSchema(schema)).toBe(true);
            expect(await schema["~standard"].validate(["1", "2"])).toEqual({ value: [1, 2] });
            expect((await schema["~standard"].validate([""])).issues).toBeDefined();
        }
        for (const missing of [undefined, []]) {
            expect(await optionalIds["~standard"].validate(missing)).toEqual({ value: undefined });
            expect(await defaultIds["~standard"].validate(missing)).toEqual({ value: [7] });
        }
        expect(await withDefault(optional(list(int())), [3])["~standard"].validate([])).toEqual({
            value: [3],
        });
    });
});
