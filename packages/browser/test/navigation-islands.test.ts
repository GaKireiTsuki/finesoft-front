import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { leaf, stack, split, type NavigationSnapshot } from "@finesoft/web";
import { FakeElement, stubDomGlobals } from "./fake-dom";
import { createEntryRenderer } from "../src/navigation-islands";
import type { RenderContext } from "../src/renderer";
beforeEach(stubDomGlobals);
afterEach(() => vi.unstubAllGlobals());
function outlet() {
    const element = new FakeElement("main");
    Object.defineProperty(element, "ownerDocument", {
        value: { createElement: (tag: string) => new FakeElement(tag) },
    });
    return element as unknown as HTMLElement;
}
const a = leaf("a", {}, { entryId: "entry-a" }),
    b = leaf("b", {}, { entryId: "entry-b" });
const page = (id: string, type = id) => ({ id, pageType: type, title: id });
const snapshot = (tree: NavigationSnapshot["tree"], ids: string[]): NavigationSnapshot =>
    ({
        tree,
        destinations: ids.map((id) => ({
            entryId: "entry-" + id,
            resourceKey: "resource-" + id,
            intent: id,
            params: {},
            page: page(id),
        })),
    }) as NavigationSnapshot;
test("native-ready settlement precedes reveal, hidden entries retain scroll, and update precedes next commit", async () => {
    const root = outlet(),
        events: string[] = [];
    let release!: () => void;
    let mounted = 0;
    const owner = createEntryRenderer({
        outlet: root,
        context: {} as RenderContext,
        renderer: {
            mount: async ({ target }) => {
                mounted++;
                if (mounted === 1) await new Promise<void>((r) => (release = r));
                target.addEventListener("fs:reveal", () => events.push("reveal"));
                return {
                    update: async () => {
                        await Promise.resolve();
                        events.push("update");
                    },
                    dispose() {},
                };
            },
        },
    });
    const first = owner.sync(snapshot(stack(a), ["a"]));
    await Promise.resolve();
    expect(events).toEqual([]);
    release();
    await first;
    expect(events).toEqual(["reveal"]);
    const original = root.querySelector<HTMLElement>("[data-fs-entry]")!;
    original.scrollTop = 53;
    await owner.sync(snapshot(stack([a, b]), ["b"]));
    original.scrollTop = 0;
    await owner.sync(snapshot(stack(a), ["a"]));
    expect(root.querySelector("[data-fs-entry]")).toBe(original);
    expect(original.scrollTop).toBe(53);
    expect(events).toContain("update");
    await owner.dispose();
    expect(root.querySelectorAll("[data-fs-entry]")).toHaveLength(0);
});
test("partial mount removes its container and final shutdown attempts every native cleanup", async () => {
    const root = outlet(),
        cleaned: string[] = [];
    let failMount = true;
    const owner = createEntryRenderer({
        outlet: root,
        context: {} as RenderContext,
        renderer: {
            mount: ({ page }) => {
                if (failMount) throw Error("mount failed");
                return {
                    update() {},
                    dispose() {
                        cleaned.push(page.id);
                        if (page.id === "a") throw Error("cleanup failed");
                    },
                };
            },
        },
    });
    await expect(owner.sync(snapshot(stack(a), ["a"]))).rejects.toThrow("mount failed");
    expect(root.querySelectorAll("[data-fs-entry]")).toHaveLength(0);
    failMount = false;
    await owner.sync(
        snapshot(
            split([
                { id: "left", content: a },
                { id: "right", content: b },
            ]),
            ["a", "b"],
        ),
    );
    await expect(owner.dispose()).rejects.toThrow("Entry cleanup failed");
    expect(cleaned).toEqual(["a", "b"]);
    expect(root.querySelectorAll("[data-fs-entry]")).toHaveLength(0);
});
