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
            navigation: { kind: "stack", entries: [{ kind: "leaf", intent: "home", params: {} }] },
            slices: { theme: "dark" },
            scoped: { "home {}": { scroll: 40 } },
        });
        expect(decodeSnapshot(encodeSnapshot(s), 1)).toEqual(s);
    });

    test("round-trips a flat url location", () => {
        const s = snap({ navigation: { url: "/posts/7" }, slices: { q: "x" } });
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
