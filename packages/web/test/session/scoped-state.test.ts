import { fixtureEntryId } from "../helpers/navigation";
import { leaf } from "../helpers/navigation";
import { describe, expect, test } from "vite-plus/test";
import { split, stack, tabs } from "../../src/navigation/nodes";
import { collectLeafKeys, createNavigationScopedState } from "../../src/session/scoped-state";

describe("collectLeafKeys (all present, not just visible)", () => {
    test("leaf collects itself", () => {
        expect(collectLeafKeys(leaf("A"))).toEqual([fixtureEntryId("A", {})]);
    });

    test("stack collects every entry (A under B)", () => {
        const tree = stack([leaf("A"), leaf("B")]);
        expect(collectLeafKeys(tree)).toEqual([fixtureEntryId("A", {}), fixtureEntryId("B", {})]);
    });

    test("tabs collects ALL branches (inactive retained)", () => {
        const tree = tabs({ active: "x", branches: { x: leaf("X"), y: leaf("Y") } });
        expect(collectLeafKeys(tree).sort()).toEqual(
            [fixtureEntryId("X", {}), fixtureEntryId("Y", {})].sort(),
        );
    });

    test("split collects all columns that have content (empty columns skipped)", () => {
        const tree = split([{ id: "sidebar", content: leaf("S") }, { id: "detail" }]);
        expect(collectLeafKeys(tree)).toEqual([fixtureEntryId("S", {})]);
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
                fixtureEntryId("A", {}),
                fixtureEntryId("B", {}),
                fixtureEntryId("L", {}),
                fixtureEntryId("D1", {}),
                fixtureEntryId("D2", {}),
            ].sort(),
        );
    });
});

describe("NavigationScopedState.prune — SwiftUI push/pop lifecycle", () => {
    test("pop B drops B, keeps A", () => {
        const s = createNavigationScopedState();
        s.set(fixtureEntryId("A", {}), { scroll: 10 });
        s.set(fixtureEntryId("B", {}), { draft: "hi" });
        // pop B → present = {A}
        s.prune(collectLeafKeys(stack([leaf("A")])));
        expect(s.get(fixtureEntryId("A", {}))).toEqual({ scroll: 10 });
        expect(s.get(fixtureEntryId("B", {}))).toBeUndefined();
    });

    test("push B keeps A (present under B), B gets its own scope", () => {
        const s = createNavigationScopedState();
        s.set(fixtureEntryId("A", {}), { scroll: 10 });
        // push B → present = {A, B}
        s.prune(collectLeafKeys(stack([leaf("A"), leaf("B")])));
        s.set(fixtureEntryId("B", {}), { draft: "hi" });
        expect(s.get(fixtureEntryId("A", {}))).toEqual({ scroll: 10 });
        expect(s.get(fixtureEntryId("B", {}))).toEqual({ draft: "hi" });
    });

    test("tab switch retains all branches", () => {
        const s = createNavigationScopedState();
        s.set(fixtureEntryId("X", {}), 1);
        s.set(fixtureEntryId("Y", {}), 2);
        const tree = tabs({ active: "y", branches: { x: leaf("X"), y: leaf("Y") } });
        s.prune(collectLeafKeys(tree));
        expect(s.get(fixtureEntryId("X", {}))).toBe(1);
        expect(s.get(fixtureEntryId("Y", {}))).toBe(2);
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
