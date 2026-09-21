import { afterEach, expect, test, vi } from "vite-plus/test";
import { defineWebApp, deny, leaf, next, stack, tabs } from "@finesoft/web";
import { createBrowserApp } from "../src/index";
import { routePages } from "../../web/test/helpers/definition";
import { DEP_KEYS, defineApp, provide, SimpleTranslator } from "@finesoft/core";

afterEach(() => vi.unstubAllGlobals());

function targetFixture() {
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
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    };
    const document = {
        cookie: "",
        documentElement: { lang: "en" },
        defaultView: win,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", document);
    const target = {
        ownerDocument: document,
        getAttribute: (name: string) => attributes.get(name) ?? null,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        contains: () => true,
        hasChildNodes: () => false,
    } as unknown as HTMLElement;
    return { target, attributes };
}

test("browser attributes and views use the injected asynchronous services", async () => {
    const { target, attributes } = targetFixture();
    const locale = { lang: "fr", dir: "rtl" };
    const translator = new SimpleTranslator({ locale: "fr", messages: { title: "Bonjour" } });
    const disposed = vi.fn();
    const definition = defineWebApp({
        id: "injected-browser",
        configuration: { locale: "en" },
        app: defineApp({
            id: "injected-browser",
            providers: [
                provide({
                    token: DEP_KEYS.LOCALE,
                    lifetime: "runtime",
                    create: async () => locale,
                }),
                provide({
                    token: DEP_KEYS.TRANSLATOR,
                    lifetime: "runtime",
                    create: async () => translator,
                    dispose: disposed,
                }),
            ],
        }),
        pages: [
            {
                id: "home",
                routes: ["/"],
                handler: async (_input, context) => {
                    expect(await context.get(DEP_KEYS.LOCALE)).toBe(locale);
                    expect(await context.get(DEP_KEYS.TRANSLATOR)).toBe(translator);
                    return { id: "home", pageType: "home", title: translator.t("title") };
                },
            },
        ],
        getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
    });
    const app = await createBrowserApp({ definition, target, history: "memory" });
    try {
        app.commit(app.getSnapshot().revision);
        await app.ready;
        expect(app.locale).toBe(locale);
        expect(app.translator).toBe(translator);
        expect(attributes.get("lang")).toBe("fr");
        expect(attributes.get("dir")).toBe("rtl");
        expect(app.getSnapshot().entries[0].page.title).toBe("Bonjour");
        expect(disposed).not.toHaveBeenCalled();
    } finally {
        await app.dispose();
    }
    expect(disposed).toHaveBeenCalledTimes(1);
});

test("a native root acknowledges the first committed browser view", async () => {
    const { target, attributes } = targetFixture();
    const recorder = { record: vi.fn(), flush: vi.fn() };
    const definition = defineWebApp({
        id: "native-start",
        configuration: { eventRecorder: recorder },
        pages: routePages(
            [{ id: "home", handler: () => ({ id: "home", pageType: "home", title: "Home" }) }],
            [{ path: "/", intentId: "home" }],
        ),
        getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
    });

    const handle = await createBrowserApp({ definition, target, history: "memory" });
    expect(handle.shouldHydrate).toBe(false);
    expect(typeof handle.perform).toBe("function");
    expect("navigation" in handle).toBe(false);
    const snapshot = handle.getSnapshot();
    expect(snapshot.entries).toHaveLength(1);
    expect(attributes.get("data-fs-app")).toBe("native-start");
    const pageViews = () => recorder.record.mock.calls.filter(([type]) => type === "PageView");
    expect(pageViews()).toHaveLength(0);
    handle.commit(snapshot.revision - 1);
    expect(pageViews()).toHaveLength(0);
    handle.commit(snapshot.revision);
    await handle.ready;
    expect(pageViews()).toHaveLength(1);
    handle.commit(snapshot.revision);
    expect(pageViews()).toHaveLength(1);
    await handle.dispose();
    expect(attributes.has("data-fs-app")).toBe(false);
});

test("DOM recovery reuses SSR page data without executing the controller again", async () => {
    const { target } = targetFixture();
    const handler = vi.fn(() => ({ id: "home", pageType: "home", title: "Fresh" }));
    const definition = defineWebApp({
        id: "dom-recovery",
        pages: routePages([{ id: "home", handler }], [{ path: "/", intentId: "home" }]),
        getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
    });
    Object.assign(target.ownerDocument, { activeElement: null, getSelection: () => null });
    Object.assign(target, {
        scrollTop: 0,
        scrollLeft: 0,
        contains: () => false,
        hasChildNodes: () => true,
        childNodes: [],
        removeChild: vi.fn(),
        querySelectorAll: () => [
            {
                localName: "svg",
                tagName: "svg",
                closest: () => target,
                getAttributeNames: () => ["data-unknown-tool"],
                hasAttribute: () => false,
            },
        ],
    });
    const app = await createBrowserApp({
        definition,
        target,
        history: "memory",
        serverDataSource: {
            parentNode: target,
            getAttribute: () => "v1:modified",
            textContent: JSON.stringify({
                protocolVersion: 2,
                buildId: "unbundled",
                payload: {
                    tree: { kind: "leaf", entryId: "ssr-home", intent: "home", params: {} },
                    pages: [
                        {
                            entryId: "ssr-home",
                            intent: { id: "home", params: {} },
                            data: { id: "home", pageType: "home", title: "Server" },
                        },
                    ],
                },
            }),
        } as unknown as HTMLScriptElement,
    });
    try {
        expect(app.shouldHydrate).toBe(false);
        expect(handler).not.toHaveBeenCalled();
        expect(app.getSnapshot().entries[0].page.title).toBe("Server");
        app.commit(app.getSnapshot().revision);
        await app.ready;
    } finally {
        await app.dispose();
    }
});

test("page type reset discards unmount change events after the native acknowledgement", async () => {
    const { target } = targetFixture();
    let pageType = "home";
    const definition = defineWebApp({
        id: "native-reset",
        pages: routePages(
            [{ id: "home", handler: () => ({ id: "home", pageType, title: "Home" }) }],
            [{ path: "/", intentId: "home" }],
        ),
        getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
    });
    const app = await createBrowserApp({
        definition,
        target,
        history: "memory",
        persistenceKey: "native-reset",
        session: {
            storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
        },
    });
    try {
        app.commit(app.getSnapshot().revision);
        await app.ready;
        const id = app.getSnapshot().entries[0].entryId;
        app.session!.scope.set(id, { business: "keep", __dom: { fields: { draft: "old" } } });
        app.subscribe(() => {
            // React emits change while removing a focused input, after host commit steps.
            app.session!.scope.set(id, {
                business: "keep",
                __dom: { fields: { draft: "late old" } },
            });
            app.commit(app.getSnapshot().revision);
        });
        pageType = "replacement";
        await app.perform({ kind: "refresh" });
        expect(app.session!.scope.get(id)).toEqual({ business: "keep" });
    } finally {
        await app.dispose();
    }
});

test.each(["beforeNavigate", "beforeCommit"] as const)(
    "initial %s denial recovers application structure on a later URL navigation",
    async (phase) => {
        const { target } = targetFixture();
        let blocked = true;
        const definition = defineWebApp({
            id: "denied-start",
            pages: routePages(
                [
                    {
                        id: "home",
                        handler: () => ({ id: "home", pageType: "home", title: "SECRET" }),
                    },
                    {
                        id: "other",
                        handler: () => ({ id: "other", pageType: "other", title: "Other" }),
                    },
                ],
                [
                    { path: "/", intentId: "home" },
                    { path: "/other", intentId: "other" },
                ],
            ),
            navigation: ({ target: entry }) =>
                tabs({
                    branches: { main: stack(entry ?? leaf("home")), other: stack(leaf("other")) },
                    active: "main",
                }),
            [phase]: [() => (blocked ? deny(403, "Denied") : next())],
            getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
        });
        const app = await createBrowserApp({ definition, target, history: "memory" });
        try {
            expect(JSON.stringify(app.getSnapshot())).not.toContain("SECRET");
            expect(app.getSnapshot().destinations[0].status).toBe(403);
            app.commit(app.getSnapshot().revision);
            await app.ready;
            app.subscribe(() => app.commit(app.getSnapshot().revision));
            blocked = false;
            await app.perform({ kind: "flow", url: "/other" });
            expect(app.getSnapshot().tree.kind).toBe("tabs");
            expect(app.getSnapshot().destinations[0].page.title).toBe("Other");
            const recovered = app.getSnapshot();
            blocked = true;
            await expect(app.perform({ kind: "flow", url: "/" })).rejects.toMatchObject({
                code: "denied",
            });
            expect(app.getSnapshot()).toBe(recovered);
        } finally {
            await app.dispose();
        }
    },
);
