import { describe, expect, test } from "vite-plus/test";
import { decodeSnapshot, encodeSnapshot } from "../../src/session/snapshot";
import { SESSION_DEFAULT_VERSION } from "../../src/session/types";
import type { SessionSnapshot } from "../../src/session/types";

const snap = (over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
    version: 1,
    slices: {},
    scoped: {},
    capturedAt: 1000,
    ...over,
});

describe("encode/decode snapshot", () => {
    test("round-trips a full snapshot", () => {
        const s = snap({
            navigation: {
                kind: "stack",
                entries: [{ kind: "leaf", entryId: "fixture-home", intent: "home", params: {} }],
            },
            slices: { theme: "dark" },
            scoped: { "home {}": { scroll: 40 } },
        });
        expect(decodeSnapshot(encodeSnapshot(s), 1)).toEqual(s);
    });

    test("round-trips a flat url location", () => {
        const s = snap({
            navigation: { entryId: "fixture-flat", url: "/posts/7" },
            slices: { q: "x" },
        });
        expect(decodeSnapshot(encodeSnapshot(s), 1)).toEqual(s);
    });

    test("round-trips a snapshot with no navigation", () => {
        const s = snap({ slices: { theme: "light" }, scoped: { "k {}": 1 } });
        expect(decodeSnapshot(encodeSnapshot(s), 1)).toEqual(s);
    });

    test("undefined raw → undefined", () => {
        expect(decodeSnapshot(undefined, 1)).toBeUndefined();
    });

    test("malformed JSON → undefined (no throw)", () => {
        expect(decodeSnapshot("{not json", 1)).toBeUndefined();
    });

    test("non-object JSON → undefined", () => {
        expect(decodeSnapshot("42", 1)).toBeUndefined();
        expect(decodeSnapshot("null", 1)).toBeUndefined();
        expect(decodeSnapshot("[1,2]", 1)).toBeUndefined();
        expect(decodeSnapshot('"hi"', 1)).toBeUndefined();
    });

    test("version mismatch → undefined", () => {
        expect(decodeSnapshot(encodeSnapshot(snap({ version: 1 })), 2)).toBeUndefined();
    });

    test("missing required field → undefined", () => {
        expect(decodeSnapshot(JSON.stringify({ version: 1, slices: {} }), 1)).toBeUndefined();
    });

    test("wrong field types → undefined", () => {
        expect(
            decodeSnapshot(
                JSON.stringify({ version: 1, slices: [], scoped: {}, capturedAt: 1 }),
                1,
            ),
        ).toBeUndefined();
        expect(
            decodeSnapshot(
                JSON.stringify({ version: 1, slices: {}, scoped: {}, capturedAt: "soon" }),
                1,
            ),
        ).toBeUndefined();
        expect(
            decodeSnapshot(
                JSON.stringify({ version: "1", slices: {}, scoped: {}, capturedAt: 1 }),
                1,
            ),
        ).toBeUndefined();
    });

    test("encode uses stable stringify (key order independent)", () => {
        const a = snap({ slices: { a: 1, b: 2 } });
        const b = snap({ slices: { b: 2, a: 1 } });
        expect(encodeSnapshot(a)).toBe(encodeSnapshot(b));
    });

    test("SESSION_DEFAULT_VERSION decodes with its own version", () => {
        const s = snap({ version: SESSION_DEFAULT_VERSION });
        expect(decodeSnapshot(encodeSnapshot(s), SESSION_DEFAULT_VERSION)).toEqual(s);
    });
});

test("snapshot cloning preserves JSON values and shared subobjects without mutating sources", async () => {
    const { cloneSnapshotValue } = await import("../../src/session/snapshot");
    const shared = { text: "value" };
    const source = { a: shared, b: shared, optional: undefined, array: [undefined, shared, null] };
    const copied = cloneSnapshotValue(source);
    expect(copied).toEqual({
        a: { text: "value" },
        b: { text: "value" },
        array: [null, { text: "value" }, null],
    });
    expect(copied.a).not.toBe(shared);
    expect(copied.a).not.toBe(copied.b);
    expect(Object.hasOwn(source, "optional")).toBe(true);
    expect(source.array[0]).toBeUndefined();
    expect(Object.isFrozen(source)).toBe(false);
    shared.text = "edited";
    expect(copied.a.text).toBe("value");
});

test("snapshot cloning rejects non-JSON values without invoking object serialization methods", async () => {
    const { cloneSnapshotValue } = await import("../../src/session/snapshot");
    let invoked = false;
    class Stateful {
        toJSON() {
            invoked = true;
            return { value: "converted" };
        }
    }
    for (const value of [NaN, Infinity, 1n, Symbol("private"), () => "private", new Stateful()]) {
        expect(() => cloneSnapshotValue({ nested: value })).toThrow("invalid-snapshot-value");
    }
    expect(invoked).toBe(false);
});
