import { expect, test, vi } from "vite-plus/test";
import {
    createAppView,
    createNavigationController,
    createWebRuntime,
    defineWebApp,
    deny,
    leaf,
    stack,
    tabs,
} from "../../src";

test.each(["beforeNavigate", "beforeCommit"] as const)(
    "initial %s denial presents only its error page without committing the candidate",
    async (phase) => {
        const web = createWebRuntime({
            definition: defineWebApp({
                id: "denied-view",
                pages: [
                    {
                        id: "private",
                        handler: () => ({ id: "private", pageType: "home", title: "SECRET" }),
                    },
                ],
                [phase]: [() => deny(403, "Denied")],
                getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
            }),
        });
        const controller = createNavigationController({ web, initial: stack(leaf("private")) });
        const presentation = createAppView({ web, controller, navigate: async () => {} });
        try {
            const original = controller.getSnapshot();
            const candidate = await controller.resolve();
            expect(candidate.rejection).toEqual(deny(403, "Denied"));
            presentation.present(candidate);
            const snapshot = presentation.view.getSnapshot();
            expect(snapshot.entries).toHaveLength(1);
            expect(snapshot.entries[0]).toMatchObject({
                visible: true,
                status: 403,
                page: { id: "403", pageType: "error", title: "Denied" },
            });
            expect(JSON.stringify(snapshot)).not.toMatch(/SECRET|private/);
            expect(controller.getSnapshot()).toBe(original);
        } finally {
            presentation.dispose();
            await controller.dispose();
            await web.dispose();
        }
    },
);

function setup() {
    let value = 1,
        type = "home";
    const definition = defineWebApp({
        id: "view",
        pages: [
            { id: "home", handler: () => ({ id: "home", pageType: type, title: String(value) }) },
            { id: "other", handler: () => ({ id: "other", pageType: "other", title: "Other" }) },
        ],
        getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
    });
    const web = createWebRuntime({ definition });
    const home = leaf("home");
    const other = leaf("other");
    const controller = createNavigationController({
        web,
        initial: tabs({ branches: { first: stack(home), second: stack(other) }, active: "first" }),
    });
    const commit = vi.fn();
    const presentation = createAppView({ web, controller, navigate: async () => {}, commit });
    return {
        web,
        home,
        other,
        controller,
        presentation,
        commit,
        set(value_: number, type_ = "home") {
            value = value_;
            type = type_;
        },
        async dispose() {
            presentation.dispose();
            await controller.dispose();
            await web.dispose();
        },
    };
}
test("snapshots retain hidden entry identity, reuse unchanged records and ignore stale native acknowledgements", async () => {
    const f = setup();
    await f.controller.resolve();
    const initial = f.presentation.view.getSnapshot();
    expect(f.presentation.view.getSnapshot()).toBe(initial);
    expect(initial.entries).toHaveLength(1);
    expect(initial.navigation.tabs?.active).toBe("first");
    await f.controller.selectTab("second");
    const hidden = f.presentation.view.getSnapshot();
    expect(hidden.entries.map((e) => [e.entryId, e.visible])).toEqual([
        [f.home.entryId, false],
        [f.other.entryId, true],
    ]);
    expect(hidden.entries[0].page).toBe(initial.entries[0].page);
    f.presentation.view.commit(initial.revision);
    expect(f.commit).not.toHaveBeenCalled();
    f.presentation.view.commit(hidden.revision);
    expect(f.commit).toHaveBeenCalledWith(hidden.revision);
    await f.controller.selectTab("first");
    expect(f.presentation.view.getSnapshot().entries[0].page).toBe(initial.entries[0].page);
    await f.dispose();
});
test("one runtime invalidation reloads retained data without replacing entry identity or removing hidden views", async () => {
    const f = setup();
    await f.controller.resolve();
    await f.controller.selectTab("second");
    const before = f.presentation.view.getSnapshot();
    f.set(2);
    f.web.runtime.invalidate(["items"]);
    await f.controller.selectTab("first");
    const fresh = f.presentation.view.getSnapshot();
    expect(fresh.entries[0]).toMatchObject({
        entryId: f.home.entryId,
        page: { title: "2" },
        visible: true,
    });
    expect(fresh.entries[1].page).toBe(before.entries[1].page);
    f.set(3, "replacement");
    await f.controller.refresh();
    expect(f.presentation.view.getSnapshot().entries[0]).toMatchObject({
        entryId: f.home.entryId,
        page: { title: "3", pageType: "replacement" },
    });
    await f.dispose();
});
test("observer exceptions do not reject committed navigation and required host failure reports committed state", async () => {
    const f = setup();
    const observer = vi.fn();
    f.controller.subscribe(() => {
        throw Error("observer");
    });
    f.controller.subscribe(observer);
    f.presentation.view.subscribe(() => {
        throw Error("view observer");
    });
    const committed = await f.controller.resolve();
    expect(committed).toBe(f.controller.getSnapshot());
    expect(observer).toHaveBeenCalledOnce();
    f.controller.onCommit(() => {
        throw Error("history unavailable");
    });
    const result = await f.controller.selectTab("second").catch((error) => error);
    expect(result).toMatchObject({
        name: "NavigationCommitError",
        committed: true,
        snapshot: f.controller.getSnapshot(),
    });
    expect(f.presentation.view.getSnapshot().navigation.tabs?.active).toBe("second");
    expect(observer).toHaveBeenCalledTimes(2);
    await f.dispose();
});
test("data invalidation during page loading prevents a stale navigation commit", async () => {
    let finish!: (page: { id: string; pageType: string; title: string }) => void;
    const handler = vi.fn(
        () =>
            new Promise<{ id: string; pageType: string; title: string }>((resolve) => {
                finish = resolve;
            }),
    );
    const web = createWebRuntime({
        definition: defineWebApp({
            id: "pending",
            pages: [{ id: "home", handler }],
            getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
        }),
    });
    const controller = createNavigationController({ web, initial: stack(leaf("home")) });
    const pending = controller.resolve().catch((error) => error);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    web.runtime.invalidate(["items"]);
    finish({ id: "old", pageType: "home", title: "Old" });
    expect(await pending).toMatchObject({ code: "cancelled" });
    expect(controller.getSnapshot().destinations).toEqual([]);
    await controller.dispose();
    await web.dispose();
});
