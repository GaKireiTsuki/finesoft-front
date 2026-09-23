import { expect, test, vi } from "vite-plus/test";
import {
    createWebSession,
    createWebRuntime,
    defineWebApp,
    deny,
    next,
    leaf,
    stack,
    split,
    serializeNavigation,
    tabs,
    type NavigationTransactionContext,
} from "../../src";

test.each(["beforeNavigate", "beforeCommit"] as const)(
    "initial %s denial presents only its error page without committing the candidate",
    async (phase) => {
        let blocked = true;
        const web = createWebRuntime({
            definition: defineWebApp({
                id: "denied-view",
                pages: [
                    {
                        id: "private",
                        handler: () => ({ id: "private", pageType: "home", title: "SECRET" }),
                    },
                ],
                [phase]: [() => (blocked ? deny(403, "Denied") : next())],
                getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
            }),
        });
        const privateEntry = leaf("private");
        const initial = stack(privateEntry);
        const controller = createWebSession({ web, initial });
        const onCommit = vi.fn();
        controller.onCommit(onCommit);
        try {
            const original = controller.getSnapshot();
            const candidate = await controller.perform({
                kind: "hydrate",
                tree: controller.getTree(),
            });
            expect(candidate.rejection).toEqual(deny(403, "Denied"));
            expect(controller.getSnapshot()).toBe(original);
            const snapshot = await controller.start();
            expect(snapshot.entries).toHaveLength(1);
            expect(snapshot.entries[0]).toMatchObject({
                visible: true,
                status: 403,
                page: { id: "403", pageType: "error", title: "Denied" },
            });
            expect(JSON.stringify(snapshot)).not.toMatch(/SECRET|private/);
            expect(controller.getSnapshot()).toBe(snapshot);
            expect(onCommit).not.toHaveBeenCalled();
            expect(controller.captureNavigation()).toEqual(serializeNavigation(initial));
            expect(controller.getTree()).toBe(initial);
            expect([...controller.presentKeys()]).toEqual([privateEntry.entryId]);
            blocked = false;
            const recovered = await controller.perform({ kind: "refresh" });
            expect(recovered).toBe(controller.getSnapshot());
            expect(recovered.destinations[0].page.title).toBe("SECRET");
            expect(onCommit).toHaveBeenCalledOnce();
        } finally {
            await controller.dispose();
            await web.dispose();
        }
    },
);

test.each(["beforeNavigate", "beforeCommit"] as const)(
    "initial %s rejection preserves structured navigation commands",
    async (phase) => {
        let blocked = true;
        const web = createWebRuntime({
            definition: defineWebApp({
                id: "retry-structure",
                pages: ["a", "b"].map((id) => ({
                    id,
                    handler: () => ({ id, pageType: id, title: id }),
                })),
                [phase]: [() => (blocked ? deny(403, "Denied") : next())],
                getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
            }),
        });
        const session = createWebSession({
            web,
            initial: tabs({ active: "a", branches: { a: stack(leaf("a")), b: stack(leaf("b")) } }),
        });
        try {
            await session.start();
            blocked = false;
            const result = await session.perform({ kind: "selectTab", key: "b" });
            expect(result).toBe(session.getSnapshot());
            expect(result.destinations[0].page.title).toBe("b");
        } finally {
            await session.dispose();
            await web.dispose();
        }
    },
);

test.each(["retry", "leave-and-return"] as const)(
    "partial initial failure cannot seed retained data: %s",
    async (mode) => {
        let blocked = true,
            value = 1;
        const handler = vi.fn(() => ({ id: "a", pageType: "a", title: String(value) }));
        const beforeNavigate = vi.fn((_context: NavigationTransactionContext) => next());
        const web = createWebRuntime({
            definition: defineWebApp({
                id: "retry-partial",
                pages: [
                    { id: "a", handler },
                    ...["b", "c"].map((id) => ({
                        id,
                        handler: () => ({ id, pageType: id, title: id }),
                    })),
                ],
                beforeLoad: [
                    (context) =>
                        blocked && context.intent.id === "b" ? deny(403, "Denied") : next(),
                ],
                beforeNavigate: [beforeNavigate],
                getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
            }),
        });
        const initial = tabs({
            active: "split",
            branches: {
                split: split([
                    { id: "a", content: stack(leaf("a")) },
                    { id: "b", content: stack(leaf("b")) },
                ]),
                other: stack(leaf("c")),
            },
        });
        const session = createWebSession({ web, initial });
        try {
            expect((await session.start()).destinations.map((entry) => entry.status)).toEqual([
                403,
            ]);
            expect(handler).toHaveBeenCalledOnce();
            blocked = false;
            value = 2;
            if (mode === "leave-and-return")
                await session.perform({ kind: "selectTab", key: "other" });
            if (mode === "retry")
                await session.perform({ kind: "hydrate", tree: session.getTree() });
            else await session.perform({ kind: "selectTab", key: "split" });
            expect(session.getSnapshot().destinations[0].page.title).toBe("2");
            expect(handler).toHaveBeenCalledTimes(2);
            expect(beforeNavigate.mock.calls[1][0].from).toMatchObject({
                tree: initial,
                destinations: [],
            });
            expect(session.getSnapshot().entries.some((entry) => entry.status !== undefined)).toBe(
                false,
            );
        } finally {
            await session.dispose();
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
    const commit = vi.fn();
    const controller = createWebSession({
        web,
        commit,
        initial: tabs({ branches: { first: stack(home), second: stack(other) }, active: "first" }),
    });
    return {
        web,
        home,
        other,
        controller,
        commit,
        set(value_: number, type_ = "home") {
            value = value_;
            type = type_;
        },
        async dispose() {
            await controller.dispose();
            await web.dispose();
        },
    };
}
test("snapshots retain hidden entry identity, reuse unchanged records and ignore stale native acknowledgements", async () => {
    const f = setup();
    await f.controller.perform({ kind: "hydrate", tree: f.controller.getTree() });
    const initial = f.controller.getSnapshot();
    expect(f.controller.getSnapshot()).toBe(initial);
    expect(initial.entries).toHaveLength(1);
    expect(initial.navigation.tabs?.active).toBe("first");
    await f.controller.perform({ kind: "selectTab", key: "second" });
    const hidden = f.controller.getSnapshot();
    expect(hidden.entries.map((e) => [e.entryId, e.visible])).toEqual([
        [f.home.entryId, false],
        [f.other.entryId, true],
    ]);
    expect(hidden.entries[0].page).toBe(initial.entries[0].page);
    f.controller.commit(initial.revision);
    expect(f.commit).not.toHaveBeenCalled();
    f.controller.commit(hidden.revision);
    expect(f.commit).toHaveBeenCalledWith(hidden.revision);
    await f.controller.perform({ kind: "selectTab", key: "first" });
    expect(f.controller.getSnapshot().entries[0].page).toBe(initial.entries[0].page);
    await f.dispose();
});

test("an initial load denial is presented but never reused as a successful page", async () => {
    let blocked = true;
    const handler = vi.fn(() => ({ id: "home", pageType: "home", title: "Home" }));
    const web = createWebRuntime({
        definition: defineWebApp({
            id: "retry-initial",
            pages: [{ id: "home", handler }],
            beforeLoad: [() => (blocked ? deny(403, "Denied") : next())],
            getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
        }),
    });
    const session = createWebSession({ web, initial: stack(leaf("home")) });
    try {
        expect((await session.start()).destinations[0].status).toBe(403);
        expect(handler).not.toHaveBeenCalled();
        blocked = false;
        const recovered = await session.perform({ kind: "hydrate", tree: session.getTree() });
        expect(recovered).toBe(session.getSnapshot());
        expect(recovered.destinations[0].page.title).toBe("Home");
        expect(recovered.destinations[0].status).toBeUndefined();
        expect(handler).toHaveBeenCalledOnce();
    } finally {
        await session.dispose();
        await web.dispose();
    }
});
test("one runtime invalidation reloads retained data without replacing entry identity or removing hidden views", async () => {
    const f = setup();
    await f.controller.perform({ kind: "hydrate", tree: f.controller.getTree() });
    await f.controller.perform({ kind: "selectTab", key: "second" });
    const before = f.controller.getSnapshot();
    f.set(2);
    f.web.runtime.invalidate(["items"]);
    await f.controller.perform({ kind: "selectTab", key: "first" });
    const fresh = f.controller.getSnapshot();
    expect(fresh.entries[0]).toMatchObject({
        entryId: f.home.entryId,
        page: { title: "2" },
        visible: true,
    });
    expect(fresh.entries[1].page).toBe(before.entries[1].page);
    f.set(3, "replacement");
    await f.controller.perform({ kind: "refresh" });
    expect(f.controller.getSnapshot().entries[0]).toMatchObject({
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
    f.controller.subscribe(() => {
        throw Error("view observer");
    });
    const committed = await f.controller.perform({ kind: "hydrate", tree: f.controller.getTree() });
    expect(committed).toBe(f.controller.getSnapshot());
    expect(observer).toHaveBeenCalledOnce();
    f.controller.onCommit(() => {
        throw Error("history unavailable");
    });
    const result = await f.controller
        .perform({ kind: "selectTab", key: "second" })
        .catch((error) => error);
    expect(result).toMatchObject({
        name: "NavigationCommitError",
        committed: true,
        snapshot: f.controller.getSnapshot(),
    });
    expect(f.controller.getSnapshot().navigation.tabs?.active).toBe("second");
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
    const controller = createWebSession({ web, initial: stack(leaf("home")) });
    const pending = controller
        .perform({ kind: "hydrate", tree: controller.getTree() })
        .catch((error) => error);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    web.runtime.invalidate(["items"]);
    finish({ id: "old", pageType: "home", title: "Old" });
    expect(await pending).toMatchObject({ code: "cancelled" });
    expect(controller.getSnapshot().destinations).toEqual([]);
    await controller.dispose();
    await web.dispose();
});

test("one committed snapshot owns navigation, native entries and persistence with one notification", async () => {
    const f = setup();
    const notifications = vi.fn();
    const previous = f.controller.getSnapshot();
    const commits = vi.fn();
    f.controller.onCommit(commits);
    f.controller.subscribe(notifications);
    const current = await f.controller.start();
    expect(current).toBe(f.controller.getSnapshot());
    expect("navigation" in f.controller).toBe(false);
    expect(current.destinations[0]).toBe(current.entries[0]);
    expect(commits).toHaveBeenCalledExactlyOnceWith(current, previous);
    expect(notifications).toHaveBeenCalledExactlyOnceWith(current);
    expect(Object.isFrozen(current)).toBe(true);
    expect(Object.isFrozen(current.entries)).toBe(true);
    expect(Object.isFrozen(current.entries[0])).toBe(true);
    await f.controller.perform({ kind: "selectTab", key: "second" });
    expect(current.entries[0].visible).toBe(true);
    expect(current.navigation.tabs?.active).toBe("first");
    expect(current.revision).toBe(1);
    expect(f.controller.getSnapshot().revision).toBe(2);
    expect(notifications).toHaveBeenCalledTimes(2);
    await f.dispose();
});
