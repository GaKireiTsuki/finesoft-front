import { afterEach, expect, test, vi } from "vite-plus/test";
import {
    ACTION_KINDS,
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

test("ordinary URL pushes retain inactive branches and existing page identities", async () => {
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
    await app.navigation.selectTab("notes");
    const notes = app.getSnapshot().entries.find((entry) => entry.intent === "notes")!;
    await app.navigation.selectTab("home");
    const home = app.getSnapshot().entries.find((entry) => entry.intent === "home")!;
    await app.navigation.navigate("/detail");
    expect(arrangements).toBe(1);
    expect(collectAllLeaves(app.getSnapshot().tree).map((entry) => entry.entryId)).toContain(
        notes.entryId,
    );
    expect(app.getSnapshot().entries.find((entry) => entry.entryId === home.entryId)?.page).toBe(
        home.page,
    );
    await app.navigation.selectTab("notes");
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
    await app.navigation.navigate("/");
    expect(app.getSnapshot().navigation.tabs?.order).toEqual(["home", "notes"]);
    expect(
        collectAllLeaves(app.getSnapshot().tree).some(
            (entry) => entry.intent === "@finesoft/not-found",
        ),
    ).toBe(false);
    await app.navigation.selectTab("notes");
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
    await app.navigation.navigate("/protected");
    expect(
        collectAllLeaves(app.getSnapshot().tree).find((entry) => entry.intent === "detail")?.url,
    ).toBe("/detail?tab=info#details");
    expect(urls).toContain("/detail?tab=info#details");
    expect(
        collectAllLeaves(app.getSnapshot().tree).some((entry) => entry.entryId === notesId),
    ).toBe(true);
});

test("native views can perform flow and compound external actions and reuse an entry", async () => {
    const { app, win } = await start();
    const home = app.getSnapshot().entries[0]!;
    await app.perform({
        kind: "compound",
        actions: [makeFlowAction("/detail"), makeExternalUrlAction("https://other.test/")],
    });
    expect(app.getSnapshot().destinations.at(-1)?.intent).toBe("detail");
    expect(win.open).toHaveBeenCalledWith("https://other.test/", "_blank", "noopener,noreferrer");
    await app.perform({ ...makeFlowAction("/"), entryId: home.entryId });
    expect(app.getSnapshot().destinations.at(-1)?.entryId).toBe(home.entryId);
    expect(app.getSnapshot().entries.find((entry) => entry.visible)?.page).toBe(home.page);
    const handled: string[] = [];
    app.actionDispatcher.removeAction(ACTION_KINDS.EXTERNAL_URL);
    app.actionDispatcher.onAction(ACTION_KINDS.EXTERNAL_URL, (action) => {
        handled.push(action.kind);
    });
    await app.perform(makeExternalUrlAction("https://custom.test/"));
    expect(handled).toEqual(["externalUrl"]);
});

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
    await expect(app.navigation.navigate(url)).rejects.toMatchObject({ code: "validation" });
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
    await expect(app.navigation.navigate("/protected")).rejects.toMatchObject({
        code: "validation",
    });
    expect(app.getSnapshot().destinations.at(-1)?.intent).toBe("home");
    expect(win.location.assign).not.toHaveBeenCalled();
});
