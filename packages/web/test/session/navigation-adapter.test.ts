import { fixtureEntryId } from "../helpers/navigation";
import { leaf } from "../helpers/navigation";
import { describe, expect, test } from "vite-plus/test";
import { createNavigationSessionAdapter } from "../../src/session/navigation-adapter";
import { stack, tabs } from "../../src/navigation/nodes";
import { serializeNavigation } from "../../src/navigation/serialization";
import { collectLeafKeys } from "../../src/session/scoped-state";
import type { NavigationController } from "../../src/navigation/controller";
import type { NavigationNode } from "../../src/navigation/types";

/** 最小假 controller —— 仅 session 适配器用到的 `getTree` / `hydrate`。 */
function fakeController(initial: NavigationNode): {
    controller: NavigationController;
    hydrated: NavigationNode[];
} {
    let tree = initial;
    const hydrated: NavigationNode[] = [];
    let snapshot = { tree, destinations: [] };
    const controller = {
        getTree: () => tree,
        getSnapshot: () => snapshot,
        hydrate: (next: NavigationNode) => {
            tree = next;
            hydrated.push(next);
            snapshot = { tree, destinations: [] };
            return Promise.resolve(snapshot);
        },
    } as unknown as NavigationController;
    return { controller, hydrated };
}

describe("createNavigationSessionAdapter (structured)", () => {
    test("capture serializes the current tree", () => {
        const tree = stack([leaf("A"), leaf("B")]);
        const { controller } = fakeController(tree);
        const adapter = createNavigationSessionAdapter(controller);
        expect(adapter.capture()).toEqual(serializeNavigation(tree));
    });

    test("apply hydrates the deserialized tree", async () => {
        const { controller, hydrated } = fakeController(leaf("home"));
        const adapter = createNavigationSessionAdapter(controller);
        const serialized = serializeNavigation(stack([leaf("A"), leaf("B")]));
        await adapter.apply(serialized);
        expect(hydrated).toHaveLength(1);
        expect(serializeNavigation(hydrated[0])).toEqual(serialized);
    });

    test("apply ignores undefined navigation", async () => {
        const { controller, hydrated } = fakeController(leaf("home"));
        const adapter = createNavigationSessionAdapter(controller);
        await adapter.apply(undefined);
        expect(hydrated).toHaveLength(0);
    });

    test("captureUrl returns the current browser url when provided", () => {
        const { controller } = fakeController(leaf("home"));
        const adapter = createNavigationSessionAdapter(controller, () => "/item/1");
        expect(adapter.captureUrl?.()).toBe("/item/1");
    });

    test("captureUrl yields undefined when no currentUrl source is provided", () => {
        const { controller } = fakeController(leaf("home"));
        const adapter = createNavigationSessionAdapter(controller);
        expect(adapter.captureUrl?.()).toBeUndefined();
    });

    test("presentKeys collects every leaf in the tree (all present, not just visible)", () => {
        const tree = tabs({
            active: "x",
            branches: { x: stack([leaf("A"), leaf("B")]), y: leaf("Y") },
        });
        const { controller } = fakeController(tree);
        const adapter = createNavigationSessionAdapter(controller);
        expect([...adapter.presentKeys()].sort()).toEqual(collectLeafKeys(tree).sort());
        expect([...adapter.presentKeys()].sort()).toEqual(
            [fixtureEntryId("A", {}), fixtureEntryId("B", {}), fixtureEntryId("Y", {})].sort(),
        );
    });
});
