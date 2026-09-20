import { afterEach, expect, test, vi } from "vite-plus/test";
import {
    ACTION_KINDS,
    ActionDispatcher,
    collectAllLeaves,
    defineWebApp,
    deny,
    leaf,
    makeExternalUrlAction,
    makeFlowAction,
    next,
    redirect,
    stack,
    tabs,
    type WebAppDefinition,
} from "@finesoft/web";
import { createBrowserApp, type BrowserAppConfig } from "../src/start-app";

test("ordinary and modal URL actions retain separate query values", async () => {
    const pages: string[] = [];
    const { app } = await start(
        {
            onModal: (page) => {
                pages.push(page.title);
            },
        },
        {
            pages: [
                {
                    id: "home",
                    routes: ["/"],
                    handler: () => ({ id: "home", pageType: "home", title: "Home" }),
                },
                {
                    id: "search",
                    routes: ["/search"],
                    handler: (_params, _context, query) => ({
                        id: "search",
                        pageType: "search",
                        title: String(query.q),
                    }),
                },
            ],
        },
    );
    await app.perform(makeFlowAction("/search?q=first"));
    expect(app.getSnapshot().destinations[0].page.title).toBe("first");
    await app.perform(makeFlowAction("/search?q=second"));
    expect(app.getSnapshot().destinations[0].page.title).toBe("second");
    await app.perform(makeFlowAction("/search?q=modal", "modal"));
    expect(pages).toEqual(["modal"]);
    expect(app.getSnapshot().destinations[0].page.title).toBe("second");
});

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.unstubAllGlobals();
});

async function start(
    overrides: Partial<BrowserAppConfig> = {},
    extra: Partial<WebAppDefinition> = {},
) {
    const attributes = new Map<string, string>();
    const win = {
        location: {
            pathname: "/",
            search: "",
            href: "https://app.test/",
            origin: "https://app.test",
            assign: vi.fn(),
        },
        navigator: { userAgent: "test", maxTouchPoints: 0 },
        open: vi.fn(),
    };
    const document = { cookie: "", documentElement: { lang: "en" }, defaultView: win };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", document);
    const target = {
        ownerDocument: document,
        getAttribute: (name: string) => attributes.get(name) ?? null,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {},
        contains: () => true,
        hasChildNodes: () => false,
    } as unknown as HTMLElement;
    const definition = defineWebApp({
        id: "actions",
        pages: [
            {
                id: "home",
                routes: ["/"],
                handler: () => ({ id: "home", pageType: "home", title: "Home" }),
            },
            {
                id: "notes",
                routes: ["/notes"],
                handler: () => ({ id: "notes", pageType: "notes", title: "Notes" }),
            },
            {
                id: "detail",
                routes: ["/detail", "/protected"],
                handler: () => ({ id: "detail", pageType: "detail", title: "Detail" }),
            },
        ],
        getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
        ...extra,
    });
    const app = await createBrowserApp({ definition, target, history: "memory", ...overrides });
    const unsubscribe = app.subscribe(() => app.commit(app.getSnapshot().revision));
    cleanups.push(async () => {
        unsubscribe();
        await app.dispose();
    });
    app.commit(app.getSnapshot().revision);
    await app.ready;
    return { app, win };
}

test("ordinary URL navigation releases departed entries across a long session", async () => {
    const { app } = await start();
    for (let index = 0; index < 100; index++) {
        const previous = app.getSnapshot().entries[0].entryId;
        await app.perform({ kind: "flow", url: `/detail?visit=${index}` });
        expect(app.getSnapshot().entries).toHaveLength(1);
        expect(collectAllLeaves(app.getSnapshot().tree)).toHaveLength(1);
        expect(app.getSnapshot().entries[0].entryId).not.toBe(previous);
        expect(app.getSnapshot().entries[0].page.title).toBe("Detail");
    }
});

test("same URL navigation reloads data in the existing page entry", async () => {
    let loads = 0;
    const { app } = await start(
        {},
        {
            pages: [
                {
                    id: "home",
                    routes: ["/"],
                    handler: () => ({ id: "home", pageType: "home", title: String(++loads) }),
                },
            ],
        },
    );
    const id = app.getSnapshot().entries[0].entryId;
    for (let index = 0; index < 3; index++) await app.perform({ kind: "flow", url: "/" });
    expect(app.getSnapshot().entries).toHaveLength(1);
    expect(app.getSnapshot().entries[0]).toMatchObject({ entryId: id, page: { title: "4" } });
});

test("explicit same-target pushes retain independent page entries", async () => {
    const { app } = await start();
    for (let index = 0; index < 3; index++) await app.perform({ kind: "push", intent: "home" });
    expect(app.getSnapshot().entries).toHaveLength(4);
    expect(new Set(app.getSnapshot().entries.map((entry) => entry.entryId)).size).toBe(4);
});

test("URL pushes in declared navigation retain inactive branches and existing page identities", async () => {
    let arrangements = 0;
    const { app } = await start(
        {},
        {
            navigation: () => {
                arrangements++;
                return tabs({
                    active: "home",
                    branches: { home: stack(leaf("home")), notes: stack(leaf("notes")) },
                });
            },
        },
    );
    await app.perform({ kind: "selectTab", key: "notes" });
    const notes = app.getSnapshot().entries.find((entry) => entry.intent === "notes")!;
    await app.perform({ kind: "selectTab", key: "home" });
    const home = app.getSnapshot().entries.find((entry) => entry.intent === "home")!;
    await app.perform({ kind: "flow", url: "/detail" });
    expect(arrangements).toBe(1);
    expect(collectAllLeaves(app.getSnapshot().tree).map((entry) => entry.entryId)).toContain(
        notes.entryId,
    );
    expect(app.getSnapshot().entries.find((entry) => entry.entryId === home.entryId)?.page).toBe(
        home.page,
    );
    await app.perform({ kind: "selectTab", key: "notes" });
    expect(app.getSnapshot().entries.find((entry) => entry.visible)?.page).toBe(notes.page);
});

test("returning from an initial unknown URL restores the application navigation structure", async () => {
    const { app, win } = await start(
        { url: "/missing" },
        {
            navigation: ({ target }) =>
                target &&
                tabs({
                    active: "home",
                    branches: { home: stack(target), notes: stack(leaf("notes")) },
                }),
        },
    );
    expect(app.getSnapshot().entries[0]?.status).toBe(404);
    await app.perform({ kind: "flow", url: "/" });
    expect(app.getSnapshot().navigation.tabs?.order).toEqual(["home", "notes"]);
    expect(
        collectAllLeaves(app.getSnapshot().tree).some(
            (entry) => entry.intent === "@finesoft/not-found",
        ),
    ).toBe(false);
    await app.perform({ kind: "selectTab", key: "notes" });
    expect(app.getSnapshot().entries.find((entry) => entry.visible)?.page.pageType).toBe("notes");
    expect(win.location.assign).not.toHaveBeenCalled();
});

test("guard redirects preserve fragments and unrelated branch identities", async () => {
    const urls: string[] = [];
    const { app } = await start(
        {},
        {
            navigation: ({ target }) =>
                tabs({
                    active: "home",
                    branches: { home: stack(target ?? leaf("home")), notes: stack(leaf("notes")) },
                }),
            beforeLoad: [
                (context) => {
                    urls.push(context.url);
                    return context.path === "/protected"
                        ? redirect("/detail?tab=info#details")
                        : next();
                },
            ],
        },
    );
    const notesId = collectAllLeaves(app.getSnapshot().tree).find(
        (entry) => entry.intent === "notes",
    )!.entryId;
    await app.perform({ kind: "flow", url: "/protected" });
    expect(
        collectAllLeaves(app.getSnapshot().tree).find((entry) => entry.intent === "detail")?.url,
    ).toBe("/detail?tab=info#details");
    expect(urls).toContain("/detail?tab=info#details");
    expect(
        collectAllLeaves(app.getSnapshot().tree).some((entry) => entry.entryId === notesId),
    ).toBe(true);
});

test("native views can perform flow and compound external actions and reuse an entry", async () => {
    const { app, win } = await start({}, { navigation: stack(leaf("home")) });
    const home = app.getSnapshot().entries[0]!;
    await app.perform({
        kind: "compound",
        actions: [makeFlowAction("/detail"), makeExternalUrlAction("https://other.test/")],
    });
    expect(app.getSnapshot().destinations.at(-1)?.intent).toBe("detail");
    expect(win.open).toHaveBeenCalledWith("https://other.test/", "_blank", "noopener,noreferrer");
    await app.perform({ kind: "reuseEntry", entryId: home.entryId });
    expect(app.getSnapshot().destinations.at(-1)?.entryId).toBe(home.entryId);
    expect(app.getSnapshot().entries.find((entry) => entry.visible)?.page).toBe(home.page);
    const handled: string[] = [];
    app.removeAction(ACTION_KINDS.EXTERNAL_URL);
    app.onAction(ACTION_KINDS.EXTERNAL_URL, (action) => {
        handled.push(action.kind);
    });
    await app.perform(makeExternalUrlAction("https://custom.test/"));
    expect(handled).toEqual(["externalUrl"]);
});

test("one action executor sequences URL, tree, modal and external navigation", async () => {
    const presented: string[] = [];
    const { app, win } = await start(
        {
            onModal: (page) => {
                presented.push(page.title);
            },
        },
        { navigation: stack(leaf("home")) },
    );
    const committed: string[] = [];
    app.subscribe(() => committed.push(app.getSnapshot().destinations.at(-1)!.intent));
    const result = await app.perform({
        kind: "compound",
        actions: [
            makeFlowAction("/detail"),
            { kind: "push", intent: "notes" },
            { kind: "pop" },
            makeFlowAction("/", "modal"),
            makeExternalUrlAction("https://other.test/"),
        ],
    });
    expect(app).toBeInstanceOf(ActionDispatcher);
    expect("navigation" in app).toBe(false);
    expect("actionDispatcher" in app).toBe(false);
    expect(committed).toEqual(["detail", "notes", "detail"]);
    expect(presented).toEqual(["Home"]);
    expect(result).toBe(app.getSnapshot());
    expect(app.getSnapshot().entries).toHaveLength(2);
    expect(win.open).toHaveBeenCalledOnce();
});

test("a rejected tree action stops nested compound effects and preserves the committed view", async () => {
    const { app, win } = await start(
        {},
        {
            navigation: stack(leaf("home")),
            beforeCommit: [
                ({ candidate }) =>
                    candidate.destinations.at(-1)?.intent === "notes"
                        ? deny(409, "Keep draft")
                        : next(),
            ],
        },
    );
    const before = app.getSnapshot();
    const result = await app.perform({
        kind: "compound",
        actions: [
            { kind: "compound", actions: [{ kind: "push", intent: "notes" }] },
            makeExternalUrlAction("https://other.test/"),
        ],
    });
    expect(result.rejection).toEqual(deny(409, "Keep draft"));
    expect(app.getSnapshot()).toBe(before);
    expect(win.open).not.toHaveBeenCalled();
});

test("a newer URL cancels an older compound without a caller AbortSignal", async () => {
    const { app } = await start({}, { navigation: stack(leaf("home")) });
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    app.removeAction("externalUrl");
    app.onAction("externalUrl", async () => {
        entered();
        await gate;
    });
    const work = app.perform({
        kind: "compound",
        actions: [makeExternalUrlAction("https://other.test/"), { kind: "push", intent: "detail" }],
    });
    const rejected = expect(work).rejects.toMatchObject({ code: "cancelled" });
    await started;
    try {
        await app.perform(makeFlowAction("/notes"));
        const latest = app.getSnapshot();
        release();
        await rejected;
        expect(app.getSnapshot()).toBe(latest);
        expect(latest.destinations.at(-1)?.intent).toBe("notes");
    } finally {
        release();
    }
});

test.each(["tree", "modal", "external"] as const)(
    "delayed URL admission respects competing %s actions",
    async (kind) => {
        let entered!: () => void, release!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const { app } = await start(
            { onModal: () => {} },
            {
                navigation: stack(leaf("home")),
                pages: [
                    {
                        id: "home",
                        routes: ["/"],
                        handler: () => ({ id: "home", pageType: "home", title: "Home" }),
                    },
                    {
                        id: "notes",
                        routes: ["/notes"],
                        handler: () => ({ id: "notes", pageType: "notes", title: "Notes" }),
                    },
                    {
                        id: "detail",
                        routes: [
                            {
                                path: "/detail",
                                query: {
                                    wait: {
                                        "~standard": {
                                            version: 1,
                                            vendor: "action-admission-test",
                                            validate: async (value: unknown) => {
                                                entered();
                                                await gate;
                                                return { value: String(value) };
                                            },
                                        },
                                    },
                                },
                            },
                        ],
                        handler: () => ({ id: "detail", pageType: "detail", title: "Detail" }),
                    },
                ],
            },
        );
        const work = app.perform(makeFlowAction("/detail?wait=1"));
        const outcome =
            kind === "tree" ? expect(work).rejects.toMatchObject({ code: "cancelled" }) : work;
        await started;
        try {
            if (kind === "tree") await app.perform({ kind: "push", intent: "notes" });
            else if (kind === "modal") await app.perform(makeFlowAction("/", "modal"));
            else await app.perform(makeExternalUrlAction("https://other.test/"));
            release();
            await outcome;
            expect(app.getSnapshot().destinations.at(-1)?.intent).toBe(
                kind === "tree" ? "notes" : "detail",
            );
        } finally {
            release();
        }
    },
);

test.each(["default", "modal"] as const)(
    "action cancellation reaches %s page loading and stops remaining effects",
    async (presentationContext) => {
        let entered!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const modal = vi.fn();
        const { app, win } = await start(
            { onModal: modal },
            {
                beforeLoad: [
                    async (context) => {
                        if (context.intent.id === "detail") {
                            entered();
                            await new Promise<void>((resolve) =>
                                context.signal!.addEventListener("abort", () => resolve(), {
                                    once: true,
                                }),
                            );
                        }
                        return next();
                    },
                ],
            },
        );
        const before = app.getSnapshot();
        const abort = new AbortController();
        const work = app.perform(
            {
                kind: "compound",
                actions: [
                    makeFlowAction("/detail", presentationContext),
                    makeExternalUrlAction("https://other.test/"),
                ],
            },
            { signal: abort.signal },
        );
        const rejected = expect(work).rejects.toMatchObject({ code: "cancelled" });
        await started;
        abort.abort();
        await rejected;
        expect(app.getSnapshot()).toBe(before);
        expect(modal).not.toHaveBeenCalled();
        expect(win.open).not.toHaveBeenCalled();
    },
);

test("modal actions use navigation policies and page guards without committing the background", async () => {
    const order: string[] = [];
    const { app } = await start(
        {
            onModal: (page, context) => {
                order.push("modal");
                expect(page.title).toBe("Detail");
                expect(context.snapshot.destinations.at(-1)?.page).toBe(page);
            },
        },
        {
            beforeNavigate: [
                () => {
                    order.push("admit");
                    return next();
                },
            ],
            beforeLoad: [
                () => {
                    order.push("before");
                    return next();
                },
            ],
            afterLoad: [
                () => {
                    order.push("after");
                    return next();
                },
            ],
            beforeCommit: [
                () => {
                    order.push("commit");
                    return next();
                },
            ],
        },
    );
    const before = app.getSnapshot();
    order.length = 0;
    await app.perform(makeFlowAction("/detail", "modal"));
    expect(order).toEqual(["admit", "before", "after", "commit", "modal"]);
    expect(app.getSnapshot()).toBe(before);
});

test("modal transaction denial never hands rejected page data to the application", async () => {
    const titles: string[] = [];
    const { app } = await start(
        {
            onModal: (page) => {
                titles.push(page.title);
            },
        },
        {
            beforeCommit: [
                ({ candidate }) =>
                    candidate.destinations.at(-1)?.intent === "detail"
                        ? deny(403, "Denied")
                        : next(),
            ],
        },
    );
    await app.perform(makeFlowAction("/detail", "modal"));
    expect(titles).toEqual(["Denied"]);
    expect(app.getSnapshot().destinations.at(-1)?.intent).toBe("home");
});

test("modal redirects keep modal presentation and an external redirect skips delivery", async () => {
    const titles: string[] = [];
    let external = false;
    const { app, win } = await start(
        {
            onModal: (page) => {
                titles.push(page.title);
            },
        },
        {
            beforeLoad: [
                ({ path }) =>
                    path === "/protected"
                        ? redirect(external ? "https://other.test/" : "/detail#modal")
                        : next(),
            ],
        },
    );
    await app.perform(makeFlowAction("/protected", "modal"));
    expect(titles).toEqual(["Detail"]);
    external = true;
    await app.perform(makeFlowAction("/protected", "modal"));
    expect(titles).toEqual(["Detail"]);
    expect(win.location.assign).toHaveBeenCalledWith("https://other.test/");
});

test("disposing the host cancels modal loading and releases its execution before returning", async () => {
    let loaded!: () => void;
    const started = new Promise<void>((resolve) => {
        loaded = resolve;
    });
    let released = 0;
    const delivered: string[] = [];
    const { app } = await start(
        {
            onModal: (page) => {
                delivered.push(page.title);
            },
        },
        {
            pages: [
                {
                    id: "home",
                    routes: ["/"],
                    handler: () => ({ id: "home", pageType: "home", title: "Home" }),
                },
                {
                    id: "slow",
                    routes: ["/slow"],
                    handler: async (_params, context) => {
                        context.onDispose(() => {
                            released++;
                        });
                        const aborted = new Promise<void>((resolve) =>
                            context.signal.addEventListener("abort", () => resolve(), {
                                once: true,
                            }),
                        );
                        loaded();
                        await aborted;
                        return { id: "slow", pageType: "slow", title: "Slow" };
                    },
                },
            ],
        },
    );
    const work = app.perform(makeFlowAction("/slow", "modal")).catch((error: unknown) => error);
    await started;
    await app.dispose();
    expect(await work).toMatchObject({ code: "cancelled" });
    expect(released).toBe(1);
    expect(delivered).toEqual([]);
    await expect(app.perform(makeFlowAction("/"))).rejects.toMatchObject({ code: "configuration" });
});

test.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///private/data",
    "http://[",
])("browser actions reject unsafe or invalid destination %s before handing off", async (url) => {
    const { app, win } = await start();
    await expect(app.perform(makeExternalUrlAction(url))).rejects.toMatchObject({
        code: "validation",
    });
    await expect(app.perform({ kind: "flow", url: url })).rejects.toMatchObject({
        code: "validation",
    });
    expect(win.open).not.toHaveBeenCalled();
    expect(win.location.assign).not.toHaveBeenCalled();
});

test("external actions retain browser-isolated HTTP and system mail/telephone links", async () => {
    const { app, win } = await start();
    for (const url of ["/help", "mailto:support@example.test", "tel:+123456789"]) {
        await app.perform(makeExternalUrlAction(url));
    }
    expect(win.open.mock.calls).toEqual([
        ["https://app.test/help", "_blank", "noopener,noreferrer"],
        ["mailto:support@example.test", "_blank", "noopener,noreferrer"],
        ["tel:+123456789", "_blank", "noopener,noreferrer"],
    ]);
});

test("guard redirects reject executable protocols without replacing the current page", async () => {
    const { app, win } = await start(
        {},
        {
            beforeLoad: [
                ({ path }) => (path === "/protected" ? redirect("javascript:alert(1)") : next()),
            ],
        },
    );
    await expect(app.perform({ kind: "flow", url: "/protected" })).rejects.toMatchObject({
        code: "validation",
    });
    expect(app.getSnapshot().destinations.at(-1)?.intent).toBe("home");
    expect(win.location.assign).not.toHaveBeenCalled();
});
