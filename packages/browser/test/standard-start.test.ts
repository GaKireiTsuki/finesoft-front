import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { defineWebApp, makeFlowAction, type BasePage, type WebAppDefinition } from "@finesoft/web";
import { HostGuardError } from "@finesoft/core";
import { startBrowserApp, type BrowserAppHandle } from "../src/start-app";
import type { BrowserRenderer } from "../src/renderer";
const handles: BrowserAppHandle[] = [];
const errorPage = (status: number, message: string): BasePage => ({
    id: String(status),
    pageType: "error",
    title: String(status),
    description: message,
});
const definition = (extra: Partial<WebAppDefinition> = {}) =>
    defineWebApp({
        id: "test",
        routes: [
            { path: "/", intentId: "home" },
            { path: "/alias", intentId: "home" },
        ],
        controllers: [
            { id: "home", handler: () => ({ id: "home", pageType: "home", title: "Home" }) },
        ],
        getErrorPage: errorPage,
        ...extra,
    });
function target() {
    return {
        querySelector: () => null,
        replaceChildren: vi.fn(),
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
        getAttribute: () => null,
        hasChildNodes: () => false,
        ownerDocument: document,
    } as unknown as HTMLElement;
}
const renderer = (): BrowserRenderer => ({
    mount: vi.fn(async () => ({ update: vi.fn(), dispose: vi.fn() })),
});
beforeEach(() => {
    vi.stubGlobal(
        "window",
        Object.assign(new EventTarget(), {
            location: { pathname: "/", search: "", origin: "https://example.test" },
            history: { state: null, pushState: vi.fn(), replaceState: vi.fn() },
        }),
    );
    vi.stubGlobal(
        "document",
        Object.assign(new EventTarget(), { documentElement: { lang: "" }, cookie: "" }),
    );
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
    await Promise.allSettled(handles.splice(0).map((handle) => handle.dispose()));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
async function start(options: Parameters<typeof startBrowserApp>[0]) {
    const handle = await startBrowserApp(options);
    handles.push(handle);
    return handle;
}

test("creates independent runtimes and waits for renderer disposal while peer stays usable", async () => {
    const events: string[] = [];
    const native: BrowserRenderer = {
        mount: async () => ({
            update() {},
            async dispose() {
                await Promise.resolve();
                events.push("disposed");
            },
        }),
    };
    const a = await start({
        app: definition(),
        renderer: native,
        target: target(),
        history: "memory",
    });
    const b = await start({
        app: definition(),
        renderer: native,
        target: target(),
        history: "memory",
    });
    expect(a.runtime).not.toBe(b.runtime);
    expect(a.navigation).toBeUndefined();
    expect(a.session).toBeUndefined();
    await a.dispose();
    expect(events).toEqual(["disposed"]);
    await b.navigate("/");
    expect(b.getSnapshot().destinations[0]?.page.title).toBe("Home");
    await expect(a.navigate("/")).rejects.toThrow("disposed");
});
test("rejects competing target and browser history owner, releasing ownership on dispose", async () => {
    const same = target();
    const a = await start({ app: definition(), renderer: renderer(), target: same });
    await expect(
        startBrowserApp({
            app: definition(),
            renderer: renderer(),
            target: same,
            history: "memory",
        }),
    ).rejects.toThrow("target already owned");
    await expect(
        startBrowserApp({ app: definition(), renderer: renderer(), target: target() }),
    ).rejects.toThrow("history already owned");
    await a.dispose();
    await start({ app: definition(), renderer: renderer(), target: same });
});
test("awaits each app dictionary before first mount without a shared loader choice", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const output: string[] = [];
    const view: BrowserRenderer = {
        mount: ({ context }) => {
            output.push(context.framework.getTranslator()!.t("hello"));
            return { update() {}, dispose() {} };
        },
    };
    const pending = start({
        app: definition({
            frameworkConfig: { locale: "en" },
            loadMessages: async () => {
                await gate;
                return { hello: "alpha" };
            },
        }),
        renderer: view,
        target: target(),
        history: "memory",
    });
    await start({
        app: definition({
            frameworkConfig: { locale: "ar" },
            loadMessages: () => ({ hello: "beta" }),
        }),
        renderer: view,
        target: target(),
        history: "memory",
    });
    expect(output).toEqual(["beta"]);
    release();
    await pending;
    expect(output).toEqual(["beta", "alpha"]);
});
test("failed dictionary and partial renderer startup release target/history ownership", async () => {
    const same = target();
    await expect(
        startBrowserApp({
            app: definition({
                frameworkConfig: { locale: "en" },
                loadMessages: () => {
                    throw Error("dictionary failed");
                },
            }),
            renderer: renderer(),
            target: same,
        }),
    ).rejects.toThrow("dictionary failed");
    let captured: BrowserAppHandle | undefined;
    await expect(
        startBrowserApp({
            app: definition(),
            renderer: {
                mount: ({ context }) => {
                    captured = context.app;
                    throw Error("mount failed");
                },
            },
            target: same,
        }),
    ).rejects.toThrow("mount failed");
    await expect(captured!.navigate("/")).rejects.toThrow("disposed");
    await start({ app: definition(), renderer: renderer(), target: same });
});
test("without dictionaries has no translator; browser network remains hostname guarded", async () => {
    const app = await start({
        app: definition(),
        renderer: renderer(),
        target: target(),
        history: "memory",
    });
    expect(app.framework.getTranslator()).toBeUndefined();
    const safeFetch = app.framework.container.resolve<typeof fetch>("safeFetch");
    await expect(safeFetch("http://127.0.0.1/private")).rejects.toBeInstanceOf(HostGuardError);
});
test("missing fetch produces an explicit dictionary capability error", async () => {
    vi.stubGlobal("fetch", undefined);
    await expect(
        startBrowserApp({
            app: definition({ frameworkConfig: { locale: "en" }, loadMessages: () => ({}) }),
            renderer: renderer(),
            target: target(),
            history: "memory",
        }),
    ).rejects.toThrow("fetch");
});
test("initial unknown URL renders 404 and alias uses its matched route URL", async () => {
    const view = renderer();
    await start({
        app: definition(),
        renderer: view,
        target: target(),
        history: "memory",
        url: "/missing",
    });
    expect(view.mount).toHaveBeenCalledWith(
        expect.objectContaining({ page: expect.objectContaining({ title: "404" }) }),
    );
    const b = await start({
        app: definition(),
        renderer: renderer(),
        target: target(),
        history: "memory",
        url: "/alias",
    });
    expect(b.getSnapshot().tree).toMatchObject({ kind: "stack", entries: [{ url: "/alias" }] });
});
test("modal flow loads guarded data without replacing the root navigation snapshot", async () => {
    const modal = vi.fn();
    const a = await start({
        app: definition(),
        renderer: renderer(),
        target: target(),
        history: "memory",
        onModal: modal,
    });
    const initial = a.getSnapshot();
    await a.framework.perform(makeFlowAction("/alias", "modal"));
    expect(modal).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Home" }),
        expect.anything(),
    );
    expect(a.getSnapshot()).toBe(initial);
});

test("initial error render context describes the rendered candidate while later denial keeps the committed view", async () => {
    const snapshots: string[][] = [];
    const view: BrowserRenderer = {
        mount: ({ page, context }) => {
            snapshots.push(context.snapshot.destinations.map((item) => item.page.title!));
            expect(context.snapshot.destinations.at(-1)?.page).toBe(page);
            return {
                update(next) {
                    expect(context.snapshot.destinations.at(-1)?.page).toBe(next);
                },
                dispose() {},
            };
        },
    };
    const app = await start({
        app: definition(),
        renderer: view,
        target: target(),
        history: "memory",
        url: "/missing",
    });
    expect(snapshots).toEqual([["404"]]);
    await app.navigate("/");
    const committed = app.getSnapshot();
    app.framework.beforeLoad(() => ({ kind: "deny", status: 403, message: "Denied" }));
    await app.navigate("/alias");
    expect(app.getSnapshot()).toBe(committed);
});

test("root type reset clears DOM state after old native view disposal and before new mount", async () => {
    const events: string[] = [];
    const element = Object.assign(new EventTarget(), target());
    element.addEventListener("fs:reset", () => events.push("reset"));
    let pageType = "home";
    const app = await start({
        app: definition({
            controllers: [
                { id: "home", handler: () => ({ id: "home", pageType, title: pageType }) },
            ],
        }),
        renderer: {
            mount() {
                events.push("mount");
                return {
                    update() {
                        events.push("update");
                    },
                    dispose() {
                        events.push("unmount-final-change");
                    },
                };
            },
        },
        target: element as unknown as HTMLElement,
        history: "memory",
    });
    events.length = 0;
    pageType = "other";
    await app.refresh();
    expect(events).toEqual(["unmount-final-change", "reset", "mount"]);
});

test("redirect navigation remains pending through final data and renderer readiness", async () => {
    let releaseData!: () => void, releaseView!: () => void;
    const data = new Promise<void>((resolve) => (releaseData = resolve));
    const ready = new Promise<void>((resolve) => (releaseView = resolve));
    const load = vi.fn(async () => {
        await data;
        return { id: "slow", pageType: "home", title: "Slow" };
    });
    const view: BrowserRenderer = {
        mount: async ({ page }) => {
            if (page.id === "slow") await ready;
            return {
                async update(page) {
                    if (page.id === "slow") await ready;
                },
                dispose() {},
            };
        },
    };
    const app = await start({
        app: definition({
            routes: [
                { path: "/", intentId: "home" },
                { path: "/redirect", intentId: "home" },
                { path: "/slow", intentId: "slow" },
            ],
            controllers: [
                { id: "home", handler: () => ({ id: "home", pageType: "home", title: "Home" }) },
                { id: "slow", handler: load },
            ],
            beforeLoad: [
                (ctx) =>
                    ctx.path === "/redirect"
                        ? { kind: "redirect", url: "/slow", status: 302 }
                        : { kind: "next" },
            ],
        }),
        renderer: view,
        target: target(),
        history: "memory",
    });
    let settled = false;
    const pending = app.navigate("/redirect").then(() => {
        settled = true;
    });
    try {
        await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
        expect(settled).toBe(false);
        releaseData();
        await vi.waitFor(() => expect(app.getSnapshot().destinations[0]?.page.title).toBe("Slow"));
        expect(settled).toBe(false);
        releaseView();
        await pending;
        expect(settled).toBe(true);
    } finally {
        releaseData();
        releaseView();
        await pending;
    }
});

test("modal missing, denied and redirected errors deliver matching candidates once without committing root", async () => {
    const pages: { page: string | undefined; snapshot: string | undefined }[] = [];
    const app = await start({
        app: definition({
            beforeLoad: [
                (ctx) =>
                    ctx.path === "/alias"
                        ? { kind: "deny", status: 403, message: "Denied" }
                        : { kind: "next" },
            ],
        }),
        renderer: renderer(),
        target: target(),
        history: "memory",
        onModal: (page, context) => {
            pages.push({
                page: page.title,
                snapshot: context.snapshot.destinations.at(-1)?.page.title,
            });
        },
    });
    const root = app.getSnapshot();
    await app.framework.perform(makeFlowAction("/missing", "modal"));
    await app.framework.perform(makeFlowAction("/alias", "modal"));
    await app.framework.perform(makeFlowAction("/", "modal"));
    app.framework.afterLoad(() => ({ kind: "deny", status: 401, message: "Login required" }));
    await app.framework.perform(makeFlowAction("/", "modal"));
    app.framework.beforeLoad((ctx) =>
        ctx.path === "/" ? { kind: "redirect", url: "/missing", status: 302 } : { kind: "next" },
    );
    await app.framework.perform(makeFlowAction("/", "modal"));
    expect(pages).toEqual([
        { page: "404", snapshot: "404" },
        { page: "403", snapshot: "403" },
        { page: "Home", snapshot: "Home" },
        { page: "401", snapshot: "401" },
        { page: "404", snapshot: "404" },
    ]);
    expect(app.getSnapshot()).toBe(root);
});

test("modal external redirect and disposal do not deliver candidates late", async () => {
    const modal = vi.fn(),
        assign = vi.fn();
    Object.assign(window.location, { assign });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const entered = vi.fn();
    const app = await start({
        app: definition(),
        renderer: renderer(),
        target: target(),
        history: "memory",
        onModal: modal,
    });
    app.framework.beforeLoad(async (ctx) => {
        if (ctx.path === "/alias")
            return { kind: "redirect", url: "https://external.example/", status: 302 };
        entered();
        await pending;
        return { kind: "deny", status: 403, message: "Denied" };
    });
    await app.framework.perform(makeFlowAction("/alias", "modal"));
    expect(assign).toHaveBeenCalledOnce();
    expect(modal).not.toHaveBeenCalled();
    const work = app.framework.perform(makeFlowAction("/", "modal")).catch((error) => error);
    try {
        await vi.waitFor(() => expect(entered).toHaveBeenCalled());
        const disposed = app.dispose();
        release();
        await disposed;
        expect(await work).toMatchObject({ code: "cancelled" });
        expect(modal).not.toHaveBeenCalled();
    } finally {
        release();
        await work;
    }
});

test("modal error callback is awaited once and rejection is owned by the action Promise", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const modal = vi.fn(async () => {
        await pending;
        throw Error("modal render failed");
    });
    const app = await start({
        app: definition(),
        renderer: renderer(),
        target: target(),
        history: "memory",
        onModal: modal,
    });
    const root = app.getSnapshot();
    let settled = false;
    const action = app.framework.perform(makeFlowAction("/missing", "modal")).then(
        () => undefined,
        (error) => {
            settled = true;
            return error;
        },
    );
    try {
        await vi.waitFor(() => expect(modal).toHaveBeenCalledOnce());
        expect(settled).toBe(false);
        release();
        expect(await action).toMatchObject({ message: "modal render failed" });
        expect(modal).toHaveBeenCalledOnce();
        expect(app.getSnapshot()).toBe(root);
    } finally {
        release();
        await action;
    }
});
