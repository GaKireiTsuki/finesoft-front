import { describe, expect, test, vi } from "vite-plus/test";
import {
    createNavigationSessionAdapter,
    createUrlSessionAdapter,
} from "../../src/session/navigation-adapter";
import { leaf, stack, tabs } from "../../src/navigation/nodes";
import { serializeNavigation } from "../../src/navigation/serialization";
import { collectLeafKeys, sessionEntryKey } from "../../src/session/scoped-state";
import type { NavigationController } from "../../src/navigation/controller";
import type { NavigationNode } from "../../src/navigation/types";

/** 最小假 controller —— 仅 session 适配器用到的 `getTree` / `hydrate`。 */
function fakeController(initial: NavigationNode): {
    controller: NavigationController;
    hydrated: NavigationNode[];
} {
    let tree = initial;
    const hydrated: NavigationNode[] = [];
    const controller = {
        getTree: () => tree,
        hydrate: (next: NavigationNode) => {
            tree = next;
            hydrated.push(next);
            return Promise.resolve({} as never);
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

    test("apply ignores a url location (structured app always has a tree)", async () => {
        const { controller, hydrated } = fakeController(leaf("home"));
        const adapter = createNavigationSessionAdapter(controller);
        await adapter.apply({ url: "/x" });
        expect(hydrated).toHaveLength(0);
    });

    test("apply ignores undefined navigation", async () => {
        const { controller, hydrated } = fakeController(leaf("home"));
        const adapter = createNavigationSessionAdapter(controller);
        await adapter.apply(undefined);
        expect(hydrated).toHaveLength(0);
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
            [sessionEntryKey("A", {}), sessionEntryKey("B", {}), sessionEntryKey("Y", {})].sort(),
        );
    });
});

describe("createUrlSessionAdapter (flat)", () => {
    test("capture returns the current url location", () => {
        const adapter = createUrlSessionAdapter({
            currentUrl: () => "/posts/7",
            navigate: () => {},
        });
        expect(adapter.capture()).toEqual({ url: "/posts/7" });
    });

    test("apply navigates to the url location", async () => {
        const navigate = vi.fn();
        const adapter = createUrlSessionAdapter({ currentUrl: () => "/", navigate });
        await adapter.apply({ url: "/posts/7" });
        expect(navigate).toHaveBeenCalledWith("/posts/7");
    });

    test("apply ignores a structured navigation (flat adapter only knows urls)", async () => {
        const navigate = vi.fn();
        const adapter = createUrlSessionAdapter({ currentUrl: () => "/", navigate });
        await adapter.apply(serializeNavigation(leaf("home")));
        expect(navigate).not.toHaveBeenCalled();
    });

    test("apply ignores undefined navigation", async () => {
        const navigate = vi.fn();
        const adapter = createUrlSessionAdapter({ currentUrl: () => "/", navigate });
        await adapter.apply(undefined);
        expect(navigate).not.toHaveBeenCalled();
    });

    test("presentKeys is a single entry from currentIntent when provided", () => {
        const adapter = createUrlSessionAdapter({
            currentUrl: () => "/posts/7",
            navigate: () => {},
            currentIntent: () => ({ intent: "post", params: { id: 7 } }),
        });
        expect([...adapter.presentKeys()]).toEqual([sessionEntryKey("post", { id: 7 })]);
    });

    test("presentKeys falls back to the current url when no currentIntent", () => {
        const adapter = createUrlSessionAdapter({
            currentUrl: () => "/posts/7",
            navigate: () => {},
        });
        expect([...adapter.presentKeys()]).toEqual(["/posts/7"]);
    });
});
