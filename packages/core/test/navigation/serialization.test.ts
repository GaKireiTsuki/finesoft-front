import { describe, expect, test } from "vite-plus/test";
import { leaf, split, stack, tabs } from "../../src/navigation/nodes";
import {
    deserializeNavigation,
    serializeNavigation,
    serializeNavigationStable,
} from "../../src/navigation/serialization";
import {
    NavigationError,
    SPLIT_VISIBILITIES,
    type NavigationNode,
    type SplitNode,
} from "../../src/navigation/types";

function roundTrip(tree: NavigationNode): NavigationNode {
    const serialized = serializeNavigation(tree);
    // simulate the real JSON boundary (history.state / HTML payload)
    const throughJson = JSON.parse(JSON.stringify(serialized));
    return deserializeNavigation(throughJson);
}

describe("serializeNavigation / deserializeNavigation round-trip", () => {
    test("single leaf (today's flat single-page tree)", () => {
        const tree = leaf("home", { ref: "x" });
        expect(roundTrip(tree)).toEqual(tree);
    });

    test("stack with nested entries", () => {
        const tree = stack([leaf("home"), leaf("detail", { id: 42 })]);
        expect(roundTrip(tree)).toEqual(tree);
    });

    test("tabs preserves active + order + branches", () => {
        const tree = tabs({
            active: "profile",
            order: ["feed", "profile"],
            branches: { feed: leaf("feed"), profile: leaf("profile", { uid: 7 }) },
        });
        expect(roundTrip(tree)).toEqual(tree);
    });

    test("split preserves empty columns (undefined content survives JSON)", () => {
        const tree = split([{ id: "list", content: leaf("list") }, { id: "detail" }]);
        const out = roundTrip(tree);
        expect(out).toEqual(tree);
        expect((out as ReturnType<typeof split>).columns[1].content).toBeUndefined();
    });

    test("deeply nested composition is lossless", () => {
        const tree = split([
            { id: "sidebar", content: leaf("sidebar") },
            {
                id: "content",
                content: tabs({
                    active: "browse",
                    branches: {
                        browse: stack([leaf("browse"), leaf("item", { id: 5, tags: ["a", "b"] })]),
                        settings: split([{ id: "panel", content: leaf("panel") }, { id: "extra" }]),
                    },
                }),
            },
        ]);
        expect(roundTrip(tree)).toEqual(tree);
    });

    test("preserves rich JSON params (numbers, booleans, nested, arrays, null)", () => {
        const tree = leaf("complex", {
            n: 1.5,
            b: true,
            s: "hi",
            nil: null,
            arr: [1, "two", false],
            nested: { deep: { value: 9 } },
        });
        expect(roundTrip(tree)).toEqual(tree);
    });

    test("serialized form is a JSON-safe plain object", () => {
        const tree = split([{ id: "a", content: leaf("a") }, { id: "b" }]);
        const serialized = serializeNavigation(tree);
        // empty column content becomes null (JSON-safe), not undefined
        expect(JSON.stringify(serialized)).toContain('"content":null');
    });
});

describe("serializeNavigationStable", () => {
    test("deterministic regardless of params key order", () => {
        const a = leaf("x", { b: 2, a: 1 });
        const b = leaf("x", { a: 1, b: 2 });
        expect(serializeNavigationStable(a)).toBe(serializeNavigationStable(b));
    });

    test("differs for structurally different trees", () => {
        expect(serializeNavigationStable(leaf("x"))).not.toBe(serializeNavigationStable(leaf("y")));
    });
});

describe("deserializeNavigation validation", () => {
    test("rejects non-object input", () => {
        expect(() => deserializeNavigation(null)).toThrow(NavigationError);
        expect(() => deserializeNavigation(42)).toThrow(NavigationError);
        expect(() => deserializeNavigation([])).toThrow(NavigationError);
    });

    test("rejects unknown kind", () => {
        expect(() => deserializeNavigation({ kind: "bogus" })).toThrow(NavigationError);
    });

    test("rejects leaf without string intent", () => {
        expect(() => deserializeNavigation({ kind: "leaf", params: {} })).toThrow(NavigationError);
        expect(() => deserializeNavigation({ kind: "leaf", intent: 1, params: {} })).toThrow(
            NavigationError,
        );
    });

    test("rejects leaf with non-object params", () => {
        expect(() => deserializeNavigation({ kind: "leaf", intent: "x", params: "no" })).toThrow(
            NavigationError,
        );
    });

    test("rejects stack with non-array entries", () => {
        expect(() => deserializeNavigation({ kind: "stack", entries: {} })).toThrow(
            NavigationError,
        );
    });

    test("rejects tabs whose active is not in branches", () => {
        expect(() =>
            deserializeNavigation({
                kind: "tabs",
                active: "ghost",
                order: ["a"],
                branches: { a: { kind: "leaf", intent: "a", params: {} } },
            }),
        ).toThrow(NavigationError);
    });

    test("rejects tabs with non-string order entries", () => {
        expect(() =>
            deserializeNavigation({
                kind: "tabs",
                active: "a",
                order: [1],
                branches: { a: { kind: "leaf", intent: "a", params: {} } },
            }),
        ).toThrow(NavigationError);
    });

    test("rejects tabs whose order contains a ghost key not present in branches", () => {
        expect(() =>
            deserializeNavigation({
                kind: "tabs",
                active: "a",
                // "ghost" 不在 branches → app 按 order 渲染时 branches["ghost"] === undefined。
                order: ["a", "ghost"],
                branches: { a: { kind: "leaf", intent: "a", params: {} } },
            }),
        ).toThrow(/order 包含不在 branches 中的键 "ghost"/);
    });

    test("ghost order key is rejected even when active itself is valid", () => {
        expect(() =>
            deserializeNavigation({
                kind: "tabs",
                active: "feed",
                order: ["feed", "profile"], // profile 缺失于 branches
                branches: { feed: { kind: "leaf", intent: "feed", params: {} } },
            }),
        ).toThrow(NavigationError);
    });

    test("accepts tabs whose order is a strict subset of branches keys", () => {
        // order 仅列出部分分支键是合法的（只要每个 order 键都存在于 branches）。
        const out = deserializeNavigation({
            kind: "tabs",
            active: "a",
            order: ["a"],
            branches: {
                a: { kind: "leaf", intent: "a", params: {} },
                b: { kind: "leaf", intent: "b", params: {} },
            },
        });
        expect((out as ReturnType<typeof tabs>).order).toEqual(["a"]);
        expect(Object.keys((out as ReturnType<typeof tabs>).branches).sort()).toEqual(["a", "b"]);
    });

    test("accepts tabs whose order exactly matches branches (round-trips)", () => {
        const tree = tabs({
            active: "profile",
            order: ["feed", "profile"],
            branches: { feed: leaf("feed"), profile: leaf("profile", { uid: 7 }) },
        });
        expect(roundTrip(tree)).toEqual(tree);
    });

    test("rejects split column without string id", () => {
        expect(() =>
            deserializeNavigation({ kind: "split", columns: [{ content: null }] }),
        ).toThrow(NavigationError);
    });

    test("propagates errors from nested malformed nodes with a path", () => {
        expect(() =>
            deserializeNavigation({
                kind: "stack",
                entries: [{ kind: "leaf", intent: "ok", params: {} }, { kind: "leaf" }],
            }),
        ).toThrow(/entries\[1\]/);
    });

    test("accepts split column content as null (empty) and restores undefined", () => {
        const out = deserializeNavigation({
            kind: "split",
            columns: [{ id: "a", content: null }],
        });
        expect((out as ReturnType<typeof split>).columns[0].content).toBeUndefined();
    });
});

describe("split 列可见性 (visibility) 序列化", () => {
    test("detailOnly 无损往返", () => {
        const tree = split(
            [
                { id: "sidebar", content: leaf("a") },
                { id: "detail", content: leaf("b") },
            ],
            SPLIT_VISIBILITIES.DETAIL_ONLY,
        );
        const out = roundTrip(tree) as SplitNode;
        expect(out).toEqual(tree);
        expect(out.visibility).toBe("detailOnly");
    });

    test("缺省 visibility → 序列化不写该字段（紧凑）", () => {
        const tree = split([{ id: "a", content: leaf("a") }]);
        const serialized = serializeNavigation(tree) as { visibility?: unknown };
        expect("visibility" in serialized).toBe(false);
        expect(roundTrip(tree)).toEqual(tree);
    });

    test("非法 visibility 值 → 抛 NavigationError", () => {
        expect(() =>
            deserializeNavigation({
                kind: "split",
                columns: [{ id: "a", content: null }],
                visibility: "bogus",
            }),
        ).toThrow(NavigationError);
    });

    test("稳定串包含 visibility（codec 紧凑编码可携带）", () => {
        const tree = split([{ id: "a", content: leaf("a") }], SPLIT_VISIBILITIES.DOUBLE_COLUMN);
        expect(serializeNavigationStable(tree)).toContain("doubleColumn");
    });
});
