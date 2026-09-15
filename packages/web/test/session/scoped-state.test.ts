import { describe, expect, test } from "vite-plus/test";
import { leaf, split, stack, tabs } from "../../src/navigation/nodes";
import {
    collectLeafKeys,
    createNavigationScopedState,
    sessionEntryKey,
} from "../../src/session/scoped-state";

describe("sessionEntryKey", () => {
    test("stable for same intent+params regardless of key order", () => {
        expect(sessionEntryKey("p", { a: 1, b: 2 })).toBe(sessionEntryKey("p", { b: 2, a: 1 }));
    });

    test("format is `intent stableStringify(params)`", () => {
        expect(sessionEntryKey("home", {})).toBe("home {}");
        expect(sessionEntryKey("post", { id: 7 })).toBe('post {"id":7}');
    });
});

describe("collectLeafKeys (all present, not just visible)", () => {
    test("leaf collects itself", () => {
        expect(collectLeafKeys(leaf("A"))).toEqual([sessionEntryKey("A", {})]);
    });

    test("stack collects every entry (A under B)", () => {
        const tree = stack([leaf("A"), leaf("B")]);
        expect(collectLeafKeys(tree)).toEqual([sessionEntryKey("A", {}), sessionEntryKey("B", {})]);
    });

    test("tabs collects ALL branches (inactive retained)", () => {
        const tree = tabs({ active: "x", branches: { x: leaf("X"), y: leaf("Y") } });
        expect(collectLeafKeys(tree).sort()).toEqual(
            [sessionEntryKey("X", {}), sessionEntryKey("Y", {})].sort(),
        );
    });

    test("split collects all columns that have content (empty columns skipped)", () => {
        const tree = split([{ id: "sidebar", content: leaf("S") }, { id: "detail" }]);
        expect(collectLeafKeys(tree)).toEqual([sessionEntryKey("S", {})]);
    });

    test("deeply nested tree (tabs of stacks + split) collects every leaf anywhere", () => {
        const tree = tabs({
            active: "main",
            branches: {
                main: stack([leaf("A"), leaf("B")]),
                side: split([
                    { id: "list", content: leaf("L") },
                    { id: "detail", content: stack([leaf("D1"), leaf("D2")]) },
                ]),
            },
        });
        expect(collectLeafKeys(tree).sort()).toEqual(
            [
                sessionEntryKey("A", {}),
                sessionEntryKey("B", {}),
                sessionEntryKey("L", {}),
                sessionEntryKey("D1", {}),
                sessionEntryKey("D2", {}),
            ].sort(),
        );
    });
});

describe("NavigationScopedState.prune — SwiftUI push/pop lifecycle", () => {
    test("pop B drops B, keeps A", () => {
        const s = createNavigationScopedState();
        s.set(sessionEntryKey("A", {}), { scroll: 10 });
        s.set(sessionEntryKey("B", {}), { draft: "hi" });
        // pop B → present = {A}
        s.prune(collectLeafKeys(stack([leaf("A")])));
        expect(s.get(sessionEntryKey("A", {}))).toEqual({ scroll: 10 });
        expect(s.get(sessionEntryKey("B", {}))).toBeUndefined();
    });

    test("push B keeps A (present under B), B gets its own scope", () => {
        const s = createNavigationScopedState();
        s.set(sessionEntryKey("A", {}), { scroll: 10 });
        // push B → present = {A, B}
        s.prune(collectLeafKeys(stack([leaf("A"), leaf("B")])));
        s.set(sessionEntryKey("B", {}), { draft: "hi" });
        expect(s.get(sessionEntryKey("A", {}))).toEqual({ scroll: 10 });
        expect(s.get(sessionEntryKey("B", {}))).toEqual({ draft: "hi" });
    });

    test("tab switch retains all branches", () => {
        const s = createNavigationScopedState();
        s.set(sessionEntryKey("X", {}), 1);
        s.set(sessionEntryKey("Y", {}), 2);
        const tree = tabs({ active: "y", branches: { x: leaf("X"), y: leaf("Y") } });
        s.prune(collectLeafKeys(tree));
        expect(s.get(sessionEntryKey("X", {}))).toBe(1);
        expect(s.get(sessionEntryKey("Y", {}))).toBe(2);
    });

    test("get/set/delete/keys", () => {
        const s = createNavigationScopedState({ k: 1 });
        expect(s.get("k")).toBe(1);
        s.set("k2", 2);
        expect([...s.keys()].sort()).toEqual(["k", "k2"]);
        s.delete("k");
        expect(s.get("k")).toBeUndefined();
    });

    test("initial snapshot is copied (mutating source after construction does not leak)", () => {
        const source = { a: 1 };
        const s = createNavigationScopedState(source);
        source.a = 999;
        expect(s.get("a")).toBe(1);
    });
});
