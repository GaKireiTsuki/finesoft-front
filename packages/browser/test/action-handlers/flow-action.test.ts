import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
    defineWebApp,
    makeFlowAction,
    makeExternalUrlAction,
    serializeNavigation,
    type BasePage,
    type NavigationSnapshot,
} from "@finesoft/web";
import { startBrowserApp, type BrowserAppHandle } from "../../src/start-app";
import * as browserApi from "../../src/index";

const { HistoryMock } = vi.hoisted(() => {
    class HistoryMock {
        static instances: HistoryMock[] = [];
        beforeTransition = vi.fn();
        replaceState = vi.fn();
        pushState = vi.fn();
        updateState = vi.fn();
        dispose = vi.fn();
        popListener?: (url: string, state?: { tree: unknown }) => Promise<void>;
        onPopState(listener: HistoryMock["popListener"]) {
            this.popListener = listener;
        }
        constructor(
            _log: unknown,
            readonly options: { getScrollablePageElement: () => HTMLElement | null },
        ) {
            HistoryMock.instances.push(this);
        }
    }
    return { HistoryMock };
});
vi.mock("../../src/utils/history", () => ({ History: HistoryMock }));
const handles: BrowserAppHandle[] = [];
const page = (id: string): BasePage => ({ id, pageType: id, title: id });
function gate() {
    let release!: () => void;
    const promise = new Promise<void>((r) => (release = r));
    return { promise, release };
}
const calls: string[] = [];
const rendered: string[] = [];
const modal = vi.fn();
const externalRedirect = vi.fn();
const scroll = { scrollTop: 0 } as HTMLElement;
function target() {
    return Object.assign(new EventTarget(), {
        querySelector: () => scroll,
        replaceChildren() {},
        setAttribute() {},
        removeAttribute() {},
        getAttribute: () => null,
        hasChildNodes: () => false,
        ownerDocument: document,
    }) as unknown as HTMLElement;
}
async function start(
    extra: Partial<Parameters<typeof defineWebApp>[0]> = {},
    history: "memory" | "browser" = "browser",
    ready?: (page: BasePage) => Promise<void>,
) {
    const app = defineWebApp({
        id: "flow-owner",
        routes: ["home", "product", "login", "secret", "slow", "next", "redirect", "loop"].map(
            (id) => ({ path: `/${id}`, intentId: id }),
        ),
        getErrorPage: (status) => page(String(status)),
        ...extra,
        controllers: ["home", "product", "login", "secret", "slow", "next", "redirect", "loop"].map(
            (id) =>
                extra.controllers?.find((controller) => controller.id === id) ?? {
                    id,
                    handler: () => {
                        calls.push(id);
                        return page(id);
                    },
                },
        ),
    });
    const show = async (value: BasePage) => {
        rendered.push(value.title!);
        await ready?.(value);
    };
    const handle = await startBrowserApp({
        app,
        target: target(),
        url: "/home",
        history,
        renderer: {
            async mount({ page }) {
                await show(page);
                return { update: show, dispose() {} };
            },
        },
        onModal: modal,
    });
    handles.push(handle);
    return handle;
}
function history() {
    return HistoryMock.instances.at(-1)!;
}
function cached(snapshot: NavigationSnapshot) {
    return { tree: serializeNavigation(snapshot.tree) };
}
beforeEach(() => {
    vi.stubGlobal(
        "window",
        Object.assign(new EventTarget(), {
            location: {
                pathname: "/home",
                search: "",
                origin: "https://app.example",
                href: "https://app.example/home",
                assign: externalRedirect,
            },
            open: vi.fn(),
            history: { state: null, replaceState: vi.fn() },
        }),
    );
    vi.stubGlobal(
        "document",
        Object.assign(new EventTarget(), { cookie: "session=abc", documentElement: { lang: "" } }),
    );
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
    await Promise.allSettled(handles.splice(0).map((app) => app.dispose()));
    HistoryMock.instances = [];
    calls.length = 0;
    rendered.length = 0;
    modal.mockClear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

test("only the standard host registers FlowAction and owns one History; removed callback engines are not public", async () => {
    expect(browserApi).not.toHaveProperty("registerFlowActionHandler");
    expect(browserApi).not.toHaveProperty("registerActionHandlers");
    const app = await start();
    await app.framework.perform(makeFlowAction("/product"));
    expect(HistoryMock.instances).toHaveLength(1);
    expect(history().options.getScrollablePageElement()).toBe(scroll);
    expect(history().replaceState).toHaveBeenCalledTimes(1);
    expect(history().pushState).toHaveBeenCalledTimes(1);
    await app.framework.perform(makeExternalUrlAction("https://external.example"));
    expect(window.open).toHaveBeenCalledWith(
        "https://external.example",
        "_blank",
        "noopener,noreferrer",
    );
    await app.dispose();
    expect(history().dispose).toHaveBeenCalledOnce();
});
test("memory host renders FlowAction without constructing History", async () => {
    const app = await start({}, "memory");
    await app.framework.perform(makeFlowAction("/product"));
    expect(HistoryMock.instances).toHaveLength(0);
    expect(rendered.at(-1)).toBe("product");
});
test("modal follows guards and redirects through the same controller without changing root/history", async () => {
    const app = await start({
        beforeLoad: [
            (ctx) =>
                ctx.path === "/redirect"
                    ? { kind: "redirect", url: "/product", status: 302 }
                    : { kind: "next" },
        ],
    });
    const before = app.getSnapshot();
    await app.framework.perform(makeFlowAction("/redirect", "modal"));
    expect(modal).toHaveBeenCalledWith(
        page("product"),
        expect.objectContaining({
            snapshot: expect.objectContaining({
                destinations: [expect.objectContaining({ page: page("product") })],
            }),
        }),
    );
    expect(app.getSnapshot()).toBe(before);
    expect(rendered).toEqual(["home"]);
    expect(history().pushState).not.toHaveBeenCalled();
});
test("before rewrite reroutes before loading; after rewrite canonicalizes without reloading", async () => {
    const app = await start({
        beforeLoad: [
            (ctx) =>
                ctx.path === "/redirect" ? { kind: "rewrite", url: "/product" } : { kind: "next" },
        ],
        afterLoad: [
            (ctx) =>
                ctx.path === "/product"
                    ? { kind: "rewrite", url: "/canonical-product" }
                    : { kind: "next" },
        ],
    });
    await app.framework.perform(makeFlowAction("/redirect"));
    expect(calls).toEqual(["home", "product"]);
    expect(rendered).toEqual(["home", "product"]);
    expect(history().pushState.mock.calls[0][1]).toBe("/canonical-product");
});
test.each(["before", "after"] as const)(
    "%sLoad denial preserves the committed URL/view and never renders secret",
    async (phase) => {
        const app = await start({
            [phase === "before" ? "beforeLoad" : "afterLoad"]: [
                (ctx: { path: string }) =>
                    ctx.path === "/secret"
                        ? { kind: "deny", status: 403, message: "denied" }
                        : { kind: "next" },
            ],
        });
        const before = app.getSnapshot();
        await app.framework.perform(makeFlowAction("/secret"));
        expect(app.getSnapshot()).toBe(before);
        expect(rendered).toEqual(["home"]);
        expect(history().pushState).not.toHaveBeenCalled();
        expect(calls.includes("secret")).toBe(phase === "after");
    },
);
test("missing and failed navigation leave earlier history and view intact", async () => {
    const app = await start({
        controllers: [
            { id: "home", handler: () => page("home") },
            {
                id: "product",
                handler: () => {
                    throw Error("failed");
                },
            },
        ],
    });
    const before = app.getSnapshot();
    await app.framework.perform(makeFlowAction("/missing"));
    await app.framework.perform(makeFlowAction("/product"));
    expect(app.getSnapshot()).toBe(before);
    expect(rendered).toEqual(["home"]);
    expect(history().pushState).not.toHaveBeenCalled();
});
test.each(["before", "after"] as const)(
    "%sLoad redirect commits only the final target once",
    async (phase) => {
        const app = await start({
            [phase === "before" ? "beforeLoad" : "afterLoad"]: [
                (ctx: { path: string }) =>
                    ctx.path === "/secret"
                        ? { kind: "redirect", url: "/login", status: 302 }
                        : { kind: "next" },
            ],
        });
        await app.framework.perform(makeFlowAction("/secret"));
        expect(rendered).toEqual(["home", "login"]);
        expect(history().pushState).toHaveBeenCalledTimes(1);
        expect(history().pushState.mock.calls[0][1]).toBe("/login");
    },
);
test("slow redirected navigation is cancelled by a newer navigation without stale commits", async () => {
    const slow = gate();
    const started = vi.fn();
    const app = await start({
        controllers: [
            { id: "home", handler: () => page("home") },
            {
                id: "slow",
                handler: async () => {
                    started();
                    await slow.promise;
                    return page("slow");
                },
            },
            { id: "next", handler: () => page("next") },
        ],
        beforeLoad: [
            (ctx) =>
                ctx.path === "/redirect"
                    ? { kind: "redirect", url: "/slow", status: 302 }
                    : { kind: "next" },
        ],
    });
    const old = app.navigate("/redirect").catch((error) => error);
    try {
        await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
        const next = app.navigate("/next");
        slow.release();
        await next;
        expect(await old).toMatchObject({ code: "cancelled" });
        expect(rendered).toEqual(["home", "next"]);
        expect(history().pushState).toHaveBeenCalledTimes(1);
    } finally {
        slow.release();
        await old;
    }
});
test("redirect loops terminate at five follows and external redirects hand off without changing the view", async () => {
    const redirects = vi.fn((ctx: { path: string }) =>
        ctx.path === "/loop"
            ? { kind: "redirect" as const, url: "/loop", status: 302 }
            : ctx.path === "/redirect"
              ? { kind: "redirect" as const, url: "https://external.example/target", status: 302 }
              : { kind: "next" as const },
    );
    const app = await start({ beforeLoad: [redirects] });
    redirects.mockClear();
    await expect(app.navigate("/loop")).rejects.toThrow("maximum 5");
    expect(redirects).toHaveBeenCalledTimes(6);
    await app.navigate("/redirect");
    expect(externalRedirect).toHaveBeenCalledWith("https://external.example/target");
    expect(rendered).toEqual(["home"]);
    expect(history().pushState).not.toHaveBeenCalled();
});
test("failed redirected destination settles within the original operation and preserves the committed view", async () => {
    const app = await start({
        beforeLoad: [
            (ctx) =>
                ctx.path === "/redirect"
                    ? { kind: "redirect", url: "/missing", status: 302 }
                    : { kind: "next" },
        ],
    });
    const before = app.getSnapshot();
    await app.navigate("/redirect");
    expect(app.getSnapshot()).toBe(before);
    expect(rendered).toEqual(["home"]);
});
test("cached pop restores the original EntryId and cached page after guards; uncached pop resolves URL", async () => {
    const app = await start();
    const original = app.getSnapshot();
    await app.navigate("/product");
    calls.length = 0;
    await history().popListener!("https://app.example/home", cached(original));
    expect(app.getSnapshot().destinations[0].entryId).toBe(original.destinations[0].entryId);
    expect(calls).toEqual([]);
    await history().popListener!("https://app.example/login");
    expect(rendered.at(-1)).toBe("login");
    expect(calls).toEqual(["login"]);
    expect(history().pushState).toHaveBeenCalledTimes(1);
    const before = app.getSnapshot();
    await expect(history().popListener!("https://app.example/missing")).rejects.toThrow(
        "Cannot restore",
    );
    expect(app.getSnapshot()).toBe(before);
});
test("uncached pop listener remains pending through loading, afterLoad and native readiness", async () => {
    const data = gate(),
        guard = gate(),
        view = gate();
    let afterStarted = false,
        viewStarted = false;
    await start(
        {
            controllers: [
                { id: "home", handler: () => page("home") },
                {
                    id: "slow",
                    handler: async () => {
                        await data.promise;
                        return page("slow");
                    },
                },
            ],
            afterLoad: [
                async (ctx) => {
                    if (ctx.path === "/slow") {
                        afterStarted = true;
                        await guard.promise;
                    }
                    return { kind: "next" };
                },
            ],
        },
        "browser",
        async (value) => {
            if (value.id === "slow") {
                viewStarted = true;
                await view.promise;
            }
        },
    );
    let settled = false;
    const work = history().popListener!("https://app.example/slow").then(() => {
        settled = true;
    });
    try {
        await Promise.resolve();
        expect(settled).toBe(false);
        data.release();
        await vi.waitFor(() => expect(afterStarted).toBe(true));
        expect(settled).toBe(false);
        guard.release();
        await vi.waitFor(() => expect(viewStarted).toBe(true));
        expect(settled).toBe(false);
        view.release();
        await work;
        expect(settled).toBe(true);
    } finally {
        data.release();
        guard.release();
        view.release();
        await work;
    }
});
test.each(["before", "after"] as const)(
    "cached pop %sLoad redirect discards the retained secret page and awaits final readiness",
    async (phase) => {
        const app = await start();
        await app.navigate("/secret");
        const secret = cached(app.getSnapshot());
        await app.navigate("/next");
        const beforeCount = history().pushState.mock.calls.length;
        calls.length = 0;
        rendered.length = 0;
        const guard = (ctx: { path: string }) =>
            ctx.path === "/secret"
                ? { kind: "redirect" as const, url: "/login", status: 302 }
                : { kind: "next" as const };
        if (phase === "before") app.framework.beforeLoad(guard);
        else app.framework.afterLoad(guard);
        await history().popListener!("https://app.example/secret", secret);
        expect(rendered).toEqual(["login"]);
        expect(calls).toEqual(["login"]);
        expect(history().pushState).toHaveBeenCalledTimes(beforeCount);
        expect(history().updateState.mock.calls.at(-1)?.[1]).toBe("/login");
    },
);
test.each(["before", "after"] as const)(
    "cached pop %sLoad denial rejects restoration while preserving committed snapshot",
    async (phase) => {
        const app = await start();
        await app.navigate("/secret");
        const secret = cached(app.getSnapshot());
        await app.navigate("/next");
        const before = app.getSnapshot();
        rendered.length = 0;
        const guard = (ctx: { path: string }) =>
            ctx.path === "/secret"
                ? { kind: "deny" as const, status: 403, message: "denied" }
                : { kind: "next" as const };
        if (phase === "before") app.framework.beforeLoad(guard);
        else app.framework.afterLoad(guard);
        await expect(history().popListener!("https://app.example/secret", secret)).rejects.toThrow(
            "Navigation rejected",
        );
        expect(app.getSnapshot()).toBe(before);
        expect(rendered).toEqual([]);
    },
);
test("pop before rewrite reloads the target and after rewrite updates only the current history URL", async () => {
    const app = await start();
    await app.navigate("/secret");
    const secret = cached(app.getSnapshot());
    await app.navigate("/next");
    calls.length = 0;
    app.framework.beforeLoad((ctx) =>
        ctx.path === "/secret" ? { kind: "rewrite", url: "/product" } : { kind: "next" },
    );
    app.framework.afterLoad((ctx) =>
        ctx.path === "/product" ? { kind: "rewrite", url: "/canonical" } : { kind: "next" },
    );
    await history().popListener!("https://app.example/secret", secret);
    expect(calls).toEqual(["product"]);
    expect(rendered.at(-1)).toBe("product");
    expect(history().updateState.mock.calls.at(-1)?.[1]).toBe("/canonical");
});
test("didEnterPage failures do not fail a ready pop or navigation", async () => {
    const app = await start();
    const report = vi.spyOn(app.framework, "didEnterPage").mockImplementation(() => {
        throw Error("metrics unavailable");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await history().popListener!("https://app.example/login");
    await app.navigate("/product");
    expect(rendered.slice(-2)).toEqual(["login", "product"]);
    expect(report).toHaveBeenCalledTimes(2);
    expect(app.framework.currentEntry?.intent).toBe("product");
});

test("a newer cached pop supersedes a pending FlowAction URL codec resolution", async () => {
    const app = await start();
    const original = app.getSnapshot();
    await app.navigate("/product");
    const pending = gate();
    const resolve = app.framework.router.resolve.bind(app.framework.router);
    const entered = vi.fn();
    vi.spyOn(app.framework.router, "resolve").mockImplementation(async (url) => {
        if (url === "/slow") {
            entered();
            await pending.promise;
        }
        return resolve(url);
    });
    const work = app.navigate("/slow");
    try {
        await vi.waitFor(() => expect(entered).toHaveBeenCalled());
        await history().popListener!("https://app.example/home", cached(original));
        pending.release();
        await work;
        expect(app.getSnapshot().destinations[0].entryId).toBe(original.destinations[0].entryId);
        expect(rendered.at(-1)).toBe("home");
    } finally {
        pending.release();
        await work;
    }
});
test("a newer FlowAction supersedes an uncached pop awaiting URL codec resolution", async () => {
    const app = await start();
    const pending = gate();
    const resolve = app.framework.routeUrl.bind(app.framework);
    const entered = vi.fn();
    vi.spyOn(app.framework, "routeUrl").mockImplementation(async (url) => {
        if (url.endsWith("/slow")) {
            entered();
            await pending.promise;
        }
        return resolve(url);
    });
    const work = history().popListener!("https://app.example/slow");
    try {
        await vi.waitFor(() => expect(entered).toHaveBeenCalled());
        await app.navigate("/next");
        pending.release();
        await work;
        expect(rendered.at(-1)).toBe("next");
    } finally {
        pending.release();
        await work;
    }
});
