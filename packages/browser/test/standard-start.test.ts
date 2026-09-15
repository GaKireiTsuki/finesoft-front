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
