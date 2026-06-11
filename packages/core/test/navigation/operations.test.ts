import { describe, expect, test } from "vite-plus/test";
import { leaf, split, stack, tabs } from "../../src/navigation/nodes";
import {
    collectAllLeaves,
    collectVisibleDestinations,
    findNearestStack,
    findNode,
    pop,
    popTo,
    popToRoot,
    push,
    replaceTop,
    resolveActivePath,
    selectColumn,
    selectTab,
    setVisibility,
    visibleSplitColumns,
} from "../../src/navigation/operations";
import { NavigationError, SPLIT_VISIBILITIES, type SplitNode } from "../../src/navigation/types";

// =====================================================================
// resolveActivePath
// =====================================================================

describe("resolveActivePath", () => {
    test("leaf root → empty path", () => {
        expect(resolveActivePath(leaf("home"))).toEqual([]);
    });

    test("stack → descends into top entry", () => {
        const tree = stack([leaf("root"), leaf("top")]);
        expect(resolveActivePath(tree)).toEqual([{ kind: "stack-entry", index: 1 }]);
    });

    test("tabs → descends into active branch", () => {
        const tree = tabs({
            active: "b",
            branches: { a: leaf("a"), b: leaf("b") },
        });
        expect(resolveActivePath(tree)).toEqual([{ kind: "tab", key: "b" }]);
    });

    test("split → descends into LAST non-empty column", () => {
        const tree = split([
            { id: "list", content: leaf("list") },
            { id: "detail", content: leaf("detail") },
        ]);
        expect(resolveActivePath(tree)).toEqual([{ kind: "column", id: "detail" }]);
    });

    test("split with trailing empty column → last non-empty", () => {
        const tree = split([{ id: "list", content: leaf("list") }, { id: "detail" }]);
        expect(resolveActivePath(tree)).toEqual([{ kind: "column", id: "list" }]);
    });

    test("nested tabs-of-stacks → through active tab into its stack top", () => {
        const tree = tabs({
            active: "browse",
            branches: {
                browse: stack([leaf("browse"), leaf("item", { id: 7 })]),
                profile: leaf("profile"),
            },
        });
        expect(resolveActivePath(tree)).toEqual([
            { kind: "tab", key: "browse" },
            { kind: "stack-entry", index: 1 },
        ]);
    });

    test("empty stack → path stops at the stack", () => {
        expect(resolveActivePath(stack([]))).toEqual([]);
    });
});

// =====================================================================
// findNode
// =====================================================================

describe("findNode", () => {
    const tree = tabs({
        active: "browse",
        branches: {
            browse: stack([leaf("browse"), leaf("item", { id: 7 })]),
            profile: leaf("profile"),
        },
    });

    test("empty path returns root", () => {
        expect(findNode(tree, [])).toBe(tree);
    });

    test("navigates tab + stack entry", () => {
        const node = findNode(tree, [
            { kind: "tab", key: "browse" },
            { kind: "stack-entry", index: 0 },
        ]);
        expect(node).toEqual(leaf("browse"));
    });

    test("returns undefined for out-of-range stack index", () => {
        expect(
            findNode(tree, [
                { kind: "tab", key: "browse" },
                { kind: "stack-entry", index: 9 },
            ]),
        ).toBeUndefined();
    });

    test("returns undefined for unknown tab key", () => {
        expect(findNode(tree, [{ kind: "tab", key: "ghost" }])).toBeUndefined();
    });

    test("returns undefined when step kind mismatches node kind", () => {
        expect(findNode(tree, [{ kind: "stack-entry", index: 0 }])).toBeUndefined();
    });

    test("returns undefined for empty split column", () => {
        const sp = split([{ id: "detail" }]);
        expect(findNode(sp, [{ kind: "column", id: "detail" }])).toBeUndefined();
    });
});

// =====================================================================
// findNearestStack
// =====================================================================

describe("findNearestStack", () => {
    test("stack target → itself", () => {
        const tree = stack([leaf("a")]);
        expect(findNearestStack(tree, [])).toEqual([]);
    });

    test("tabs whose active branch is a stack → descends to the stack", () => {
        const tree = tabs({
            active: "browse",
            branches: { browse: stack([leaf("browse")]), profile: leaf("profile") },
        });
        expect(findNearestStack(tree, [])).toEqual([{ kind: "tab", key: "browse" }]);
    });

    test("split last column is a stack → descends through column", () => {
        const tree = split([
            { id: "list", content: leaf("list") },
            { id: "detail", content: stack([leaf("detail")]) },
        ]);
        expect(findNearestStack(tree, [])).toEqual([{ kind: "column", id: "detail" }]);
    });

    test("leaf-only tree → undefined", () => {
        expect(findNearestStack(leaf("x"), [])).toBeUndefined();
    });

    test("tabs whose active branch is a leaf → undefined", () => {
        const tree = tabs({ active: "a", branches: { a: leaf("a") } });
        expect(findNearestStack(tree, [])).toBeUndefined();
    });

    test("invalid start path → undefined", () => {
        expect(findNearestStack(leaf("x"), [{ kind: "tab", key: "nope" }])).toBeUndefined();
    });
});

// =====================================================================
// push
// =====================================================================

describe("push", () => {
    test("pushes onto the active stack", () => {
        const tree = stack([leaf("home")]);
        const next = push(tree, leaf("detail", { id: 1 })) as ReturnType<typeof stack>;
        expect(next.entries).toEqual([leaf("home"), leaf("detail", { id: 1 })]);
    });

    test("does not mutate the input tree (immutability)", () => {
        const tree = stack([leaf("home")]);
        const snapshot = JSON.parse(JSON.stringify(tree));
        push(tree, leaf("detail"));
        expect(tree).toEqual(snapshot);
    });

    test("structural sharing: unaffected siblings are reused by reference", () => {
        const profile = leaf("profile");
        const tree = tabs({
            active: "browse",
            branches: { browse: stack([leaf("browse")]), profile },
        });
        const next = push(tree, leaf("item")) as ReturnType<typeof tabs>;
        // sibling branch object identity preserved
        expect(next.branches.profile).toBe(profile);
        // active branch is a new object
        expect(next.branches.browse).not.toBe(tree.branches.browse);
    });

    test("pushes into nested tabs-of-stacks active path", () => {
        const tree = tabs({
            active: "browse",
            branches: { browse: stack([leaf("browse")]), profile: leaf("profile") },
        });
        const next = push(tree, leaf("item", { id: 9 }));
        const dest = collectVisibleDestinations(next);
        expect(dest).toEqual([leaf("item", { id: 9 })]);
    });

    test("throws NavigationError when active path has no stack", () => {
        expect(() => push(leaf("x"), leaf("y"))).toThrow(NavigationError);
    });

    test("honors explicit target path", () => {
        const tree = split([
            { id: "list", content: stack([leaf("list")]) },
            { id: "detail", content: stack([leaf("detail")]) },
        ]);
        // default active path = last non-empty column (detail); target the FIRST column instead
        const next = push(tree, leaf("added"), [{ kind: "column", id: "list" }]);
        const listStack = findNode(next, [{ kind: "column", id: "list" }]) as ReturnType<
            typeof stack
        >;
        expect(listStack.entries).toEqual([leaf("list"), leaf("added")]);
        // detail column untouched (structural sharing)
        expect(findNode(next, [{ kind: "column", id: "detail" }])).toBe(
            findNode(tree, [{ kind: "column", id: "detail" }]),
        );
    });
});

// =====================================================================
// pop / popToRoot / popTo / replaceTop
// =====================================================================

describe("pop", () => {
    test("pops one entry by default", () => {
        const tree = stack([leaf("a"), leaf("b"), leaf("c")]);
        const next = pop(tree) as ReturnType<typeof stack>;
        expect(next.entries).toEqual([leaf("a"), leaf("b")]);
    });

    test("pops multiple entries", () => {
        const tree = stack([leaf("a"), leaf("b"), leaf("c")]);
        const next = pop(tree, 2) as ReturnType<typeof stack>;
        expect(next.entries).toEqual([leaf("a")]);
    });

    test("never pops below the root entry", () => {
        const tree = stack([leaf("a"), leaf("b")]);
        const next = pop(tree, 99) as ReturnType<typeof stack>;
        expect(next.entries).toEqual([leaf("a")]);
    });

    test("pop at root (single entry) is a no-op and returns same reference", () => {
        const tree = stack([leaf("a")]);
        expect(pop(tree)).toBe(tree);
    });

    test("count <= 0 returns the same tree", () => {
        const tree = stack([leaf("a"), leaf("b")]);
        expect(pop(tree, 0)).toBe(tree);
    });

    test("throws when no stack on active path", () => {
        expect(() => pop(leaf("x"))).toThrow(NavigationError);
    });
});

describe("popToRoot", () => {
    test("pops back to the root entry", () => {
        const tree = stack([leaf("a"), leaf("b"), leaf("c")]);
        const next = popToRoot(tree) as ReturnType<typeof stack>;
        expect(next.entries).toEqual([leaf("a")]);
    });

    test("already at root → same reference", () => {
        const tree = stack([leaf("a")]);
        expect(popToRoot(tree)).toBe(tree);
    });
});

describe("popTo", () => {
    test("pops to a given index (keeps [0..index])", () => {
        const tree = stack([leaf("a"), leaf("b"), leaf("c"), leaf("d")]);
        const next = popTo(tree, 1) as ReturnType<typeof stack>;
        expect(next.entries).toEqual([leaf("a"), leaf("b")]);
    });

    test("index at top → same reference (no-op)", () => {
        const tree = stack([leaf("a"), leaf("b")]);
        expect(popTo(tree, 1)).toBe(tree);
    });

    test("throws on out-of-range index", () => {
        const tree = stack([leaf("a"), leaf("b")]);
        expect(() => popTo(tree, 5)).toThrow(NavigationError);
        expect(() => popTo(tree, -1)).toThrow(NavigationError);
    });
});

describe("replaceTop", () => {
    test("replaces the top entry only", () => {
        const tree = stack([leaf("a"), leaf("b")]);
        const next = replaceTop(tree, leaf("z")) as ReturnType<typeof stack>;
        expect(next.entries).toEqual([leaf("a"), leaf("z")]);
    });

    test("does not mutate input", () => {
        const tree = stack([leaf("a"), leaf("b")]);
        const snapshot = JSON.parse(JSON.stringify(tree));
        replaceTop(tree, leaf("z"));
        expect(tree).toEqual(snapshot);
    });
});

// =====================================================================
// selectTab
// =====================================================================

describe("selectTab", () => {
    test("switches the active branch on the nearest tabs", () => {
        const tree = tabs({
            active: "a",
            branches: { a: leaf("a"), b: leaf("b") },
        });
        const next = selectTab(tree, "b") as ReturnType<typeof tabs>;
        expect(next.active).toBe("b");
        expect(next.order).toEqual(["a", "b"]);
    });

    test("selecting the already-active tab returns the same reference", () => {
        const tree = tabs({ active: "a", branches: { a: leaf("a"), b: leaf("b") } });
        expect(selectTab(tree, "a")).toBe(tree);
    });

    test("throws NavigationError on unknown branch", () => {
        const tree = tabs({ active: "a", branches: { a: leaf("a") } });
        expect(() => selectTab(tree, "ghost")).toThrow(NavigationError);
    });

    test("throws NavigationError when the active path has no tabs", () => {
        expect(() => selectTab(stack([leaf("a")]), "x")).toThrow(NavigationError);
    });

    test("explicit target on a non-tabs node throws NavigationError", () => {
        const tree = tabs({
            active: "a",
            branches: { a: stack([leaf("a")]) },
        });
        // target points at the stack (a non-tabs node)
        expect(() =>
            selectTab(tree, "x", [
                { kind: "tab", key: "a" },
                { kind: "stack-entry", index: 0 },
            ]),
        ).toThrow(NavigationError);
    });

    test("selects a deeper tabs via nesting (nearest active tabs is the outer one)", () => {
        const tree = tabs({
            active: "outerA",
            branches: {
                outerA: tabs({
                    active: "innerX",
                    branches: { innerX: leaf("x"), innerY: leaf("y") },
                }),
                outerB: leaf("b"),
            },
        });
        const next = selectTab(tree, "outerB") as ReturnType<typeof tabs>;
        expect(next.active).toBe("outerB");
    });
});

// =====================================================================
// selectColumn
// =====================================================================

describe("selectColumn", () => {
    test("sets a column's content", () => {
        const tree = split([{ id: "list", content: leaf("list") }, { id: "detail" }]);
        const next = selectColumn(tree, "detail", leaf("detail", { id: 3 })) as ReturnType<
            typeof split
        >;
        expect(next.columns[1].content).toEqual(leaf("detail", { id: 3 }));
    });

    test("clears all columns AFTER the selected one", () => {
        const tree = split([
            { id: "a", content: leaf("a") },
            { id: "b", content: leaf("b") },
            { id: "c", content: leaf("c") },
        ]);
        const next = selectColumn(tree, "a", leaf("a2")) as ReturnType<typeof split>;
        expect(next.columns.map((c) => c.content)).toEqual([leaf("a2"), undefined, undefined]);
    });

    test("setting content to undefined clears the column", () => {
        const tree = split([
            { id: "a", content: leaf("a") },
            { id: "b", content: leaf("b") },
        ]);
        const next = selectColumn(tree, "b", undefined) as ReturnType<typeof split>;
        expect(next.columns[1].content).toBeUndefined();
    });

    test("columns BEFORE the selected one are preserved by reference", () => {
        const colA = leaf("a");
        const tree = split([
            { id: "a", content: colA },
            { id: "b", content: leaf("b") },
        ]);
        const next = selectColumn(tree, "b", leaf("b2")) as ReturnType<typeof split>;
        expect(next.columns[0].content).toBe(colA);
    });

    test("throws NavigationError on unknown column", () => {
        const tree = split([{ id: "list" }]);
        expect(() => selectColumn(tree, "ghost", leaf("x"))).toThrow(NavigationError);
    });

    test("throws NavigationError when active path has no split", () => {
        expect(() => selectColumn(stack([leaf("a")]), "x", leaf("y"))).toThrow(NavigationError);
    });
});

// =====================================================================
// collectVisibleDestinations
// =====================================================================

describe("collectVisibleDestinations", () => {
    test("leaf → [leaf]", () => {
        expect(collectVisibleDestinations(leaf("home"))).toEqual([leaf("home")]);
    });

    test("stack → visible top only", () => {
        const tree = stack([leaf("root"), leaf("top")]);
        expect(collectVisibleDestinations(tree)).toEqual([leaf("top")]);
    });

    test("tabs → only the active branch", () => {
        const tree = tabs({
            active: "b",
            branches: { a: leaf("a"), b: leaf("b") },
        });
        expect(collectVisibleDestinations(tree)).toEqual([leaf("b")]);
    });

    test("split → concat of each non-empty column (in order)", () => {
        const tree = split([
            { id: "list", content: leaf("list") },
            { id: "detail", content: leaf("detail") },
        ]);
        expect(collectVisibleDestinations(tree)).toEqual([leaf("list"), leaf("detail")]);
    });

    test("split → empty columns are skipped", () => {
        const tree = split([{ id: "list", content: leaf("list") }, { id: "detail" }]);
        expect(collectVisibleDestinations(tree)).toEqual([leaf("list")]);
    });

    test("deeply nested composition: split(detail = tabs(active = stack))", () => {
        const tree = split([
            { id: "sidebar", content: leaf("sidebar") },
            {
                id: "content",
                content: tabs({
                    active: "browse",
                    branches: {
                        browse: stack([leaf("browse"), leaf("item", { id: 5 })]),
                        settings: leaf("settings"),
                    },
                }),
            },
        ]);
        expect(collectVisibleDestinations(tree)).toEqual([
            leaf("sidebar"),
            leaf("item", { id: 5 }),
        ]);
    });

    test("empty stack contributes no destinations", () => {
        const tree = split([
            { id: "a", content: stack([]) },
            { id: "b", content: leaf("b") },
        ]);
        expect(collectVisibleDestinations(tree)).toEqual([leaf("b")]);
    });
});

// =====================================================================
// 列可见性：visibleSplitColumns / collectVisibleDestinations / setVisibility
// =====================================================================

describe("visibleSplitColumns", () => {
    const threeCol = split([
        { id: "sidebar", content: leaf("folders") },
        { id: "content", content: leaf("list") },
        { id: "detail", content: leaf("message") },
    ]);

    test("automatic（缺省）→ 全部列", () => {
        expect(visibleSplitColumns(threeCol).map((c) => c.id)).toEqual([
            "sidebar",
            "content",
            "detail",
        ]);
    });

    test("all → 全部列", () => {
        const node = setVisibility(threeCol, SPLIT_VISIBILITIES.ALL) as SplitNode;
        expect(visibleSplitColumns(node).map((c) => c.id)).toEqual([
            "sidebar",
            "content",
            "detail",
        ]);
    });

    test("doubleColumn（三列）→ 首 + 末，隐藏中间", () => {
        const node = setVisibility(threeCol, SPLIT_VISIBILITIES.DOUBLE_COLUMN) as SplitNode;
        expect(visibleSplitColumns(node).map((c) => c.id)).toEqual(["sidebar", "detail"]);
    });

    test("detailOnly → 仅末列", () => {
        const node = setVisibility(threeCol, SPLIT_VISIBILITIES.DETAIL_ONLY) as SplitNode;
        expect(visibleSplitColumns(node).map((c) => c.id)).toEqual(["detail"]);
    });

    test("doubleColumn（两列）→ 等价全部（首=末去重）", () => {
        const twoCol = split(
            [
                { id: "sidebar", content: leaf("a") },
                { id: "detail", content: leaf("b") },
            ],
            SPLIT_VISIBILITIES.DOUBLE_COLUMN,
        );
        expect(visibleSplitColumns(twoCol).map((c) => c.id)).toEqual(["sidebar", "detail"]);
    });

    test("单列 doubleColumn / detailOnly → 该列本身（无越界）", () => {
        const oneCol = split(
            [{ id: "only", content: leaf("x") }],
            SPLIT_VISIBILITIES.DOUBLE_COLUMN,
        );
        expect(visibleSplitColumns(oneCol).map((c) => c.id)).toEqual(["only"]);
        const oneColDetail = setVisibility(oneCol, SPLIT_VISIBILITIES.DETAIL_ONLY) as SplitNode;
        expect(visibleSplitColumns(oneColDetail).map((c) => c.id)).toEqual(["only"]);
    });

    test("空列 split → 空数组（不抛）", () => {
        const empty = split([], SPLIT_VISIBILITIES.DETAIL_ONLY);
        expect(visibleSplitColumns(empty)).toEqual([]);
    });
});

describe("collectVisibleDestinations 受可见性裁剪", () => {
    const tree = split([
        { id: "sidebar", content: leaf("folders") },
        { id: "content", content: leaf("list") },
        { id: "detail", content: leaf("message") },
    ]);

    test("detailOnly → 仅预取 detail 目标（深链场景）", () => {
        const node = setVisibility(tree, SPLIT_VISIBILITIES.DETAIL_ONLY);
        expect(collectVisibleDestinations(node)).toEqual([leaf("message")]);
    });

    test("doubleColumn → 跳过中间 content 列", () => {
        const node = setVisibility(tree, SPLIT_VISIBILITIES.DOUBLE_COLUMN);
        expect(collectVisibleDestinations(node)).toEqual([leaf("folders"), leaf("message")]);
    });

    test("automatic（缺省）→ 全列，与既有行为一致（向后兼容）", () => {
        expect(collectVisibleDestinations(tree)).toEqual([
            leaf("folders"),
            leaf("list"),
            leaf("message"),
        ]);
    });

    test("嵌套：tabs 内 split 的 detailOnly 也生效", () => {
        const nested = tabs({
            active: "mail",
            branches: {
                mail: split(
                    [
                        { id: "sidebar", content: leaf("folders") },
                        { id: "detail", content: leaf("msg") },
                    ],
                    SPLIT_VISIBILITIES.DETAIL_ONLY,
                ),
            },
        });
        expect(collectVisibleDestinations(nested)).toEqual([leaf("msg")]);
    });
});

describe("setVisibility", () => {
    const tree = split([
        { id: "sidebar", content: leaf("a") },
        { id: "detail", content: leaf("b") },
    ]);

    test("默认 target → 最近激活 split，设置 visibility", () => {
        const next = setVisibility(tree, SPLIT_VISIBILITIES.DETAIL_ONLY) as SplitNode;
        expect(next.visibility).toBe("detailOnly");
    });

    test("不可变：原树不变，返回新节点", () => {
        const next = setVisibility(tree, SPLIT_VISIBILITIES.ALL);
        expect((tree as SplitNode).visibility).toBeUndefined();
        expect(next).not.toBe(tree);
    });

    test("保留列内容（只改 visibility）", () => {
        const next = setVisibility(tree, SPLIT_VISIBILITIES.DETAIL_ONLY) as SplitNode;
        expect(next.columns).toEqual((tree as SplitNode).columns);
    });

    test("显式 target 命中嵌套 split", () => {
        const nested = tabs({
            active: "mail",
            branches: { mail: split([{ id: "detail", content: leaf("m") }]) },
        });
        const next = setVisibility(nested, SPLIT_VISIBILITIES.DETAIL_ONLY, [
            { kind: "tab", key: "mail" },
        ]);
        const inner = findNode(next, [{ kind: "tab", key: "mail" }]) as SplitNode;
        expect(inner.visibility).toBe("detailOnly");
    });

    test("激活路径无 split → 抛 NavigationError", () => {
        expect(() => setVisibility(leaf("home"), SPLIT_VISIBILITIES.ALL)).toThrow(NavigationError);
    });

    test("target 指向非 split 节点 → 抛 NavigationError", () => {
        const t = tabs({ active: "a", branches: { a: leaf("a") } });
        expect(() => setVisibility(t, SPLIT_VISIBILITIES.ALL, [])).toThrow(NavigationError);
    });

    test("selectColumn 保留已设的 visibility", () => {
        const withVis = setVisibility(tree, SPLIT_VISIBILITIES.DOUBLE_COLUMN);
        const afterSelect = selectColumn(withVis, "detail", leaf("c")) as SplitNode;
        expect(afterSelect.visibility).toBe("doubleColumn");
    });
});

// =====================================================================
// collectAllLeaves（全部存在，非仅可见）
// =====================================================================

describe("collectAllLeaves", () => {
    test("leaf → [leaf]", () => {
        expect(collectAllLeaves(leaf("home"))).toEqual([leaf("home")]);
    });

    test("stack → ALL entries（含非顶，区别于 collectVisibleDestinations）", () => {
        const tree = stack([leaf("root"), leaf("top")]);
        expect(collectAllLeaves(tree)).toEqual([leaf("root"), leaf("top")]);
        // 对照：可见只取栈顶
        expect(collectVisibleDestinations(tree)).toEqual([leaf("top")]);
    });

    test("tabs → ALL branches（含未激活），按 Object.values 序", () => {
        const tree = tabs({ active: "a", branches: { a: leaf("a"), b: leaf("b") } });
        expect(collectAllLeaves(tree)).toEqual([leaf("a"), leaf("b")]);
    });

    test("split → 全部非空列；空列跳过", () => {
        const tree = split([{ id: "list", content: leaf("list") }, { id: "detail" }]);
        expect(collectAllLeaves(tree)).toEqual([leaf("list")]);
    });

    test("嵌套：收集隐藏栈底 + 未激活分支的全部叶子", () => {
        const tree = tabs({
            active: "home",
            branches: {
                home: stack([leaf("home"), leaf("detail", { id: 2 })]),
                notes: stack([leaf("notes")]),
            },
        });
        expect(collectAllLeaves(tree)).toEqual([
            leaf("home"),
            leaf("detail", { id: 2 }),
            leaf("notes"),
        ]);
    });

    test("空栈 / 空 split 列 → 无叶子（不抛）", () => {
        expect(collectAllLeaves(stack([]))).toEqual([]);
        expect(collectAllLeaves(split([{ id: "detail" }]))).toEqual([]);
    });
});
