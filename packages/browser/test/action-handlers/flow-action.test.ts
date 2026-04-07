import type { Logger } from "@finesoft/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

const { HistoryMock } = vi.hoisted(() => {
    class HistoryMock<State> {
        static instances: HistoryMock<unknown>[] = [];

        readonly beforeTransition = vi.fn();
        readonly replaceState = vi.fn();
        readonly pushState = vi.fn();
        readonly replaceUrl = vi.fn();
        readonly pushUrl = vi.fn();
        readonly onPopState = vi.fn(
            (listener: (url: string, state?: State) => void | Promise<void>) => {
                this.popListener = listener;
            },
        );

        popListener: ((url: string, state?: State) => void | Promise<void>) | undefined;

        constructor(
            public readonly log: Logger,
            public readonly options: {
                getScrollablePageElement: () => HTMLElement | null;
            },
        ) {
            HistoryMock.instances.push(this as HistoryMock<unknown>);
        }

        static latest<T>(): HistoryMock<T> {
            const instance = HistoryMock.instances.at(-1);
            if (!instance) {
                throw new Error("No HistoryMock instance created");
            }
            return instance as HistoryMock<T>;
        }

        static reset(): void {
            HistoryMock.instances = [];
        }
    }

    return { HistoryMock };
});

vi.mock("../../src/utils/history", () => ({
    History: HistoryMock,
}));

vi.mock("@finesoft/core", async () => import("../../../core/src/index.ts"));

import { ACTION_KINDS, type BasePage } from "../../../core/src/index.ts";
import { registerFlowActionHandler } from "../../src/action-handlers/flow-action";

afterEach(() => {
    HistoryMock.reset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

beforeEach(() => {
    vi.stubGlobal("window", {
        location: {
            pathname: "/current",
            search: "",
            origin: "https://app.example",
            href: "https://app.example/current",
        },
        addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
        cookie: "session=abc",
        documentElement: { scrollTop: 0 },
        getElementById: vi.fn(() => null),
    });
});

describe("registerFlowActionHandler", () => {
    test("opens modal pages without updating application state", async () => {
        const page = makePage("modal");
        const { framework, getHandler } = makeFramework({
            routeUrl: vi.fn(() => makeMatch("modal")),
            dispatch: vi.fn(async () => page),
        });
        const callbacks = makeCallbacks();
        const updateApp = vi.fn();

        registerFlowActionHandler({
            framework: framework as never,
            log: makeLogger(),
            callbacks,
            updateApp,
            getScrollablePageElement: vi.fn(() => null),
        });

        await getHandler()({
            kind: ACTION_KINDS.FLOW,
            url: "/modal",
            presentationContext: "modal",
        });

        expect(callbacks.onModal).toHaveBeenCalledWith(page);
        expect(updateApp).not.toHaveBeenCalled();
    });

    test("replaces the first navigation and pushes rewritten follow-up navigations", async () => {
        const homePage = makePage("home");
        const productPage = makePage("product");
        const { framework, getHandler } = makeFramework({
            routeUrl: vi.fn((url: string) => {
                if (url === "/home") {
                    return makeMatch("home");
                }
                if (url === "/products?id=1") {
                    return makeMatch("product", undefined, () => ({
                        kind: "rewrite",
                        url: "/products/1",
                    }));
                }
                return undefined;
            }),
            dispatch: vi.fn(async (intent: { id: string }) =>
                intent.id === "home" ? homePage : productPage,
            ),
        });
        const callbacks = makeCallbacks();
        const updateApp = vi.fn();
        const log = makeLogger();

        registerFlowActionHandler({
            framework: framework as never,
            log,
            callbacks,
            updateApp,
            getScrollablePageElement: vi.fn(() => null),
        });

        const handler = getHandler();
        await handler({ kind: ACTION_KINDS.FLOW, url: "/home" });
        await expect(updateApp.mock.calls[0][0].page).resolves.toEqual(homePage);

        const history = HistoryMock.latest<{ page: BasePage }>();
        expect(history.beforeTransition).toHaveBeenCalledTimes(1);
        expect(history.replaceState).toHaveBeenCalledWith({ page: homePage }, "/home");
        expect(callbacks.onNavigate).toHaveBeenNthCalledWith(1, "/home");
        expect(framework.didEnterPage).toHaveBeenNthCalledWith(1, homePage);

        await handler({ kind: ACTION_KINDS.FLOW, url: "/products?id=1" });
        await expect(updateApp.mock.calls[1][0].page).resolves.toEqual(productPage);

        expect(history.beforeTransition).toHaveBeenCalledTimes(2);
        expect(history.pushState).toHaveBeenCalledWith({ page: productPage }, "/products/1");
        expect(callbacks.onNavigate).toHaveBeenNthCalledWith(2, "/products/1");
        expect(framework.didEnterPage).toHaveBeenNthCalledWith(2, productPage);
        expect(log.debug).toHaveBeenCalledWith("afterLoad → rewrite URL to /products/1");
    });

    test("follows beforeLoad redirects and warns when a route does not exist", async () => {
        const redirectedPage = makePage("login");
        const { framework, getHandler } = makeFramework({
            routeUrl: vi.fn((url: string) => {
                if (url === "/start") {
                    return makeMatch("start", () => ({
                        kind: "redirect",
                        url: "/login",
                        status: 302,
                    }));
                }
                if (url === "/login") {
                    return makeMatch("login");
                }
                return undefined;
            }),
            dispatch: vi.fn(async () => redirectedPage),
        });
        const log = makeLogger();
        const updateApp = vi.fn();

        registerFlowActionHandler({
            framework: framework as never,
            log,
            callbacks: makeCallbacks(),
            updateApp,
            getScrollablePageElement: vi.fn(() => null),
        });

        const handler = getHandler();
        await handler({ kind: ACTION_KINDS.FLOW, url: "/start" });
        await expect(updateApp.mock.calls[0][0].page).resolves.toEqual(redirectedPage);

        expect(log.debug).toHaveBeenCalledWith("beforeLoad → redirect to /login");
        expect(HistoryMock.latest<{ page: BasePage }>().replaceState).toHaveBeenCalledWith(
            { page: redirectedPage },
            "/login",
        );

        await handler({ kind: ACTION_KINDS.FLOW, url: "/missing" });
        expect(log.warn).toHaveBeenCalledWith("FlowAction: no route for /missing");
    });

    test("updates the URL when page loading fails", async () => {
        const failure = new Error("boom");
        const { framework, getHandler } = makeFramework({
            routeUrl: vi.fn(() => makeMatch("broken")),
            dispatch: vi.fn(async () => {
                throw failure;
            }),
        });
        const callbacks = makeCallbacks();
        const updateApp = vi.fn();

        registerFlowActionHandler({
            framework: framework as never,
            log: makeLogger(),
            callbacks,
            updateApp,
            getScrollablePageElement: vi.fn(() => null),
        });

        await getHandler()({ kind: ACTION_KINDS.FLOW, url: "/broken" });

        const history = HistoryMock.latest<{ page: BasePage }>();
        await expect(updateApp.mock.calls[0][0].page).rejects.toThrow("boom");
        expect(history.replaceUrl).toHaveBeenCalledWith("/broken");
        expect(callbacks.onNavigate).toHaveBeenCalledWith("/broken");
    });

    test("handles popstate with cached pages and unroutable URLs", async () => {
        const page = makePage("cached");
        const { framework } = makeFramework({
            routeUrl: vi.fn(() => undefined),
        });
        const callbacks = makeCallbacks();
        const updateApp = vi.fn();
        const log = makeLogger();

        registerFlowActionHandler({
            framework: framework as never,
            log,
            callbacks,
            updateApp,
            getScrollablePageElement: vi.fn(() => null),
        });

        const history = HistoryMock.latest<{ page: BasePage }>();
        await history.popListener?.("https://app.example/back", { page });

        expect(callbacks.onNavigate).toHaveBeenNthCalledWith(1, "/back");
        expect(updateApp).toHaveBeenNthCalledWith(1, {
            page,
            isFirstPage: true,
        });
        expect(framework.didEnterPage).toHaveBeenNthCalledWith(1, page);

        await history.popListener?.("https://app.example/missing", undefined);

        expect(callbacks.onNavigate).toHaveBeenNthCalledWith(2, "/missing");
        await expect(updateApp.mock.calls[1][0].page).rejects.toThrow("404");
        expect(framework.didEnterPage).toHaveBeenCalledTimes(1);
        expect(log.error).toHaveBeenCalledWith(
            "received popstate without data, but URL was unroutable:",
            "https://app.example/missing",
        );
    });

    test("stops recursive redirects after the configured safety limit", async () => {
        const log = makeLogger();
        const updateApp = vi.fn();
        const { framework, getHandler } = makeFramework({
            routeUrl: vi.fn(() =>
                makeMatch("loop", () => ({
                    kind: "redirect",
                    url: "/loop",
                    status: 302,
                })),
            ),
        });

        registerFlowActionHandler({
            framework: framework as never,
            log,
            callbacks: makeCallbacks(),
            updateApp,
            getScrollablePageElement: vi.fn(() => null),
        });

        await getHandler()({ kind: ACTION_KINDS.FLOW, url: "/loop" });

        expect(updateApp).not.toHaveBeenCalled();
        expect(log.error).toHaveBeenCalledWith(
            "Navigation redirect loop detected (5 redirects), stopping at: /loop",
        );
    });

    test("handles popstate redirects, rewrites, and denied routes before data loading", async () => {
        const loginPage = makePage("login");
        const profilePage = makePage("profile");
        const { framework } = makeFramework({
            routeUrl: vi.fn((url: string) => {
                if (url === "/redirect") {
                    return makeMatch("redirect", () => ({
                        kind: "redirect",
                        url: "/login",
                        status: 302,
                    }));
                }
                if (url === "/login") {
                    return makeMatch("login");
                }
                if (url === "/rewrite") {
                    return makeMatch("rewrite", () => ({
                        kind: "rewrite",
                        url: "/profile",
                    }));
                }
                if (url === "/profile") {
                    return makeMatch("profile");
                }
                if (url === "/denied") {
                    return makeMatch("denied", () => ({
                        kind: "deny",
                        status: 403,
                        message: "blocked",
                    }));
                }
                return undefined;
            }),
            dispatch: vi.fn(async (intent: { id: string }) =>
                intent.id === "login" ? loginPage : profilePage,
            ),
        });
        const callbacks = makeCallbacks();
        const updateApp = vi.fn();
        const log = makeLogger();

        registerFlowActionHandler({
            framework: framework as never,
            log,
            callbacks,
            updateApp,
            getScrollablePageElement: vi.fn(() => null),
        });

        const history = HistoryMock.latest<{ page: BasePage }>();

        await history.popListener?.("https://app.example/redirect", undefined);
        await expect(updateApp.mock.calls[0][0].page).resolves.toEqual(loginPage);

        await history.popListener?.("https://app.example/rewrite", undefined);
        await expect(updateApp.mock.calls[1][0].page).resolves.toEqual(profilePage);

        await history.popListener?.("https://app.example/denied", undefined);

        expect(log.debug).toHaveBeenCalledWith("popstate beforeLoad → redirect to /login");
        expect(history.replaceState).toHaveBeenCalledWith({ page: loginPage }, "/login");
        expect(history.pushState).toHaveBeenCalledWith({ page: profilePage }, "/profile");
        expect(callbacks.onNavigate).toHaveBeenNthCalledWith(1, "/redirect");
        expect(callbacks.onNavigate).toHaveBeenNthCalledWith(2, "/login");
        expect(callbacks.onNavigate).toHaveBeenNthCalledWith(3, "/rewrite");
        expect(callbacks.onNavigate).toHaveBeenNthCalledWith(4, "/profile");
        expect(callbacks.onNavigate).toHaveBeenNthCalledWith(5, "/denied");
        expect(updateApp).toHaveBeenCalledTimes(2);
        expect(log.warn).toHaveBeenCalledWith("popstate beforeLoad → denied");
    });

    test("loads uncached popstate routes and reports didEnterPage failures", async () => {
        const page = makePage("fresh");
        const enterError = new Error("enter failed");
        const { framework } = makeFramework({
            routeUrl: vi.fn(() => makeMatch("fresh")),
            dispatch: vi.fn(async () => page),
            didEnterPage: vi.fn(() => {
                throw enterError;
            }),
        });
        const callbacks = makeCallbacks();
        const updateApp = vi.fn();
        const log = makeLogger();

        registerFlowActionHandler({
            framework: framework as never,
            log,
            callbacks,
            updateApp,
            getScrollablePageElement: vi.fn(() => null),
        });

        await HistoryMock.latest<{ page: BasePage }>().popListener?.(
            "https://app.example/fresh?tab=1",
            undefined,
        );
        await expect(updateApp.mock.calls[0][0].page).resolves.toEqual(page);
        await Promise.resolve();

        expect(callbacks.onNavigate).toHaveBeenCalledWith("/fresh");
        expect(log.error).toHaveBeenCalledWith("didEnterPage error:", enterError);
    });
});

function makeFramework(overrides: Partial<Record<string, unknown>> = {}) {
    const actionHandlers = new Map<string, (action: Record<string, unknown>) => Promise<void>>();
    const framework = {
        container: {},
        onAction: vi.fn(
            (kind: string, handler: (action: Record<string, unknown>) => Promise<void>) => {
                actionHandlers.set(kind, handler);
            },
        ),
        routeUrl: vi.fn(),
        dispatch: vi.fn(async () => makePage("default")),
        runBeforeLoad: vi.fn(async (_ctx: unknown, guards: Array<() => unknown> = []) => {
            if (guards.length === 0) {
                return { kind: "next" };
            }
            return guards[0]();
        }),
        runAfterLoad: vi.fn(async (_ctx: unknown, guards: Array<() => unknown> = []) => {
            if (guards.length === 0) {
                return { kind: "next" };
            }
            return guards[0]();
        }),
        didEnterPage: vi.fn(),
        ...overrides,
    };

    return {
        framework,
        getHandler: () => {
            const handler = actionHandlers.get(ACTION_KINDS.FLOW);
            if (!handler) {
                throw new Error("Flow handler was not registered");
            }
            return handler;
        },
    };
}

function makeMatch(
    id: string,
    beforeGuard?: () => unknown,
    afterGuard?: () => unknown,
): {
    intent: { id: string; params: Record<string, string> };
    beforeGuards: Array<() => unknown>;
    afterGuards: Array<() => unknown>;
} {
    return {
        intent: { id, params: id === "product" ? { id: "1" } : {} },
        beforeGuards: beforeGuard ? [beforeGuard] : [],
        afterGuards: afterGuard ? [afterGuard] : [],
    };
}

function makeCallbacks() {
    return {
        onNavigate: vi.fn(),
        onModal: vi.fn(),
    };
}

function makePage(id: string): BasePage {
    return {
        id,
        pageType: "test",
        title: id,
    };
}

function makeLogger(): Logger & {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
} {
    return {
        debug: vi.fn(() => ""),
        info: vi.fn(() => ""),
        warn: vi.fn(() => ""),
        error: vi.fn(() => ""),
    };
}
