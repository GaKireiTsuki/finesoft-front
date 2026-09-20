import { afterEach, describe, expect, test } from "vite-plus/test";
import { fixtureEntryId, leaf } from "../helpers/navigation";
import {
    createWebRuntime,
    createWebSession,
    defineWebApp,
    serializeNavigation,
    stack,
    tabs,
    type NavigationNode,
} from "../../src";
import { collectLeafKeys } from "../../src/session/scoped-state";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
    for (const dispose of cleanup.splice(0)) await dispose();
});
function session(initial: NavigationNode, captureUrl?: () => string) {
    const web = createWebRuntime({
        definition: defineWebApp({
            id: "persistence",
            pages: ["A", "B", "Y", "home"].map((id) => ({
                id,
                handler: () => ({ id, pageType: id, title: id }),
            })),
            getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
        }),
    });
    const result = createWebSession({ web, initial, captureUrl });
    cleanup.push(async () => {
        await result.dispose();
        await web.dispose();
    });
    return result;
}

describe("WebSession persistence port", () => {
    test("capture serializes the current tree", () => {
        const tree = stack([leaf("A"), leaf("B")]);
        expect(session(tree).captureNavigation()).toEqual(serializeNavigation(tree));
    });

    test("restore hydrates the deserialized tree", async () => {
        const webSession = session(leaf("home"));
        const serialized = serializeNavigation(stack([leaf("A"), leaf("B")]));
        await webSession.restoreNavigation(serialized);
        expect(webSession.captureNavigation()).toEqual(serialized);
        expect(webSession.getSnapshot().destinations[0].page.title).toBe("B");
    });

    test("restore ignores undefined navigation", async () => {
        const webSession = session(leaf("home"));
        const before = webSession.getSnapshot();
        await webSession.restoreNavigation(undefined);
        expect(webSession.getSnapshot()).toBe(before);
    });

    test("captureUrl returns the current browser url when provided", () => {
        expect(session(leaf("home"), () => "/item/1").captureUrl?.()).toBe("/item/1");
    });

    test("captureUrl yields undefined when no source is provided", () => {
        expect(session(leaf("home")).captureUrl?.()).toBeUndefined();
    });

    test("presentKeys includes hidden leaves that have never been loaded", async () => {
        const tree = tabs({
            active: "x",
            branches: { x: stack([leaf("A"), leaf("B")]), y: leaf("Y") },
        });
        const webSession = session(tree);
        await webSession.start();
        expect(webSession.getSnapshot().entries).toHaveLength(1);
        expect([...webSession.presentKeys()].sort()).toEqual(collectLeafKeys(tree).sort());
        expect([...webSession.presentKeys()].sort()).toEqual(
            [fixtureEntryId("A", {}), fixtureEntryId("B", {}), fixtureEntryId("Y", {})].sort(),
        );
    });
});
