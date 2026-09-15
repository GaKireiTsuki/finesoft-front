import { describe, expect, test } from "vite-plus/test";
import {
    isLeafNode,
    isSplitNode,
    isStackNode,
    isTabsNode,
    leaf,
    split,
    stack,
    tabs,
} from "../../src/navigation/nodes";
import {
    NAVIGATION_NODE_KINDS,
    SPLIT_VISIBILITIES,
    type NavigationNode,
} from "../../src/navigation/types";

describe("navigation/nodes constructors", () => {
    test("leaf builds a leaf with default empty params", () => {
        expect(leaf("home")).toEqual({
            kind: NAVIGATION_NODE_KINDS.LEAF,
            intent: "home",
            params: {},
        });
        expect(leaf("product", { id: 42 })).toEqual({
            kind: NAVIGATION_NODE_KINDS.LEAF,
            intent: "product",
            params: { id: 42 },
        });
    });

    test("stack accepts a single root node", () => {
        const s = stack(leaf("home"));
        expect(s.kind).toBe(NAVIGATION_NODE_KINDS.STACK);
        expect(s.entries).toEqual([leaf("home")]);
    });

    test("stack accepts an array of entries (root..top)", () => {
        const s = stack([leaf("home"), leaf("detail", { id: 1 })]);
        expect(s.entries).toHaveLength(2);
        expect(s.entries[0]).toEqual(leaf("home"));
        expect(s.entries[1]).toEqual(leaf("detail", { id: 1 }));
    });

    test("stack copies the input array (no aliasing)", () => {
        const entries: NavigationNode[] = [leaf("home")];
        const s = stack(entries);
        entries.push(leaf("extra"));
        expect(s.entries).toHaveLength(1);
    });

    test("tabs derives order from branches insertion order when omitted", () => {
        const t = tabs({
            active: "feed",
            branches: { feed: leaf("feed"), profile: leaf("profile") },
        });
        expect(t.order).toEqual(["feed", "profile"]);
        expect(t.active).toBe("feed");
    });

    test("tabs uses explicit order when provided", () => {
        const t = tabs({
            active: "a",
            order: ["b", "a"],
            branches: { a: leaf("a"), b: leaf("b") },
        });
        expect(t.order).toEqual(["b", "a"]);
    });

    test("tabs copies branches and order (no aliasing)", () => {
        const branches = { a: leaf("a") };
        const order = ["a"];
        const t = tabs({ active: "a", branches, order });
        order.push("mutated");
        expect(t.order).toEqual(["a"]);
        expect(Object.keys(t.branches)).toEqual(["a"]);
    });

    test("split normalizes columns; missing content becomes undefined", () => {
        const sp = split([{ id: "list", content: leaf("list") }, { id: "detail" }]);
        expect(sp.kind).toBe(NAVIGATION_NODE_KINDS.SPLIT);
        expect(sp.columns).toEqual([
            { id: "list", content: leaf("list") },
            { id: "detail", content: undefined },
        ]);
    });

    test("split 缺省 visibility 不写字段；显式传入则携带", () => {
        const bare = split([{ id: "detail" }]);
        expect("visibility" in bare).toBe(false);
        const withVis = split([{ id: "detail" }], SPLIT_VISIBILITIES.DETAIL_ONLY);
        expect(withVis.visibility).toBe("detailOnly");
    });
});

describe("navigation/nodes guards", () => {
    const nodes: NavigationNode[] = [
        leaf("x"),
        stack(leaf("x")),
        tabs({ active: "a", branches: { a: leaf("a") } }),
        split([{ id: "c" }]),
    ];

    test("isLeafNode narrows only leaf", () => {
        expect(nodes.filter(isLeafNode)).toEqual([leaf("x")]);
    });

    test("isStackNode narrows only stack", () => {
        expect(nodes.filter(isStackNode).map((n) => n.kind)).toEqual([NAVIGATION_NODE_KINDS.STACK]);
    });

    test("isTabsNode narrows only tabs", () => {
        expect(nodes.filter(isTabsNode).map((n) => n.kind)).toEqual([NAVIGATION_NODE_KINDS.TABS]);
    });

    test("isSplitNode narrows only split", () => {
        expect(nodes.filter(isSplitNode).map((n) => n.kind)).toEqual([NAVIGATION_NODE_KINDS.SPLIT]);
    });
});
