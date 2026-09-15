vi.mock("@finesoft/web", async () => import("../../../web/src/index.ts"));
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

import { ACTION_KINDS, Framework } from "@finesoft/web";
import { type BasePage } from "@finesoft/web";
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
        history: { state: { id: "history-entry" }, replaceState: vi.fn() },
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
        expect(history.replaceState).toHaveBeenCalledWith(
            expect.objectContaining({ page: homePage, entryId: expect.any(String) }),
            "/home",
        );
        expect(callbacks.onNavigate).toHaveBeenNthCalledWith(1, "/home");
        expect(framework.didEnterPage).toHaveBeenNthCalledWith(1, homePage);

        await handler({ kind: ACTION_KINDS.FLOW, url: "/products?id=1" });
        await expect(updateApp.mock.calls[1][0].page).resolves.toEqual(productPage);

        expect(history.beforeTransition).toHaveBeenCalledTimes(2);
        expect(history.pushState).toHaveBeenCalledWith(
            expect.objectContaining({ page: productPage, entryId: expect.any(String) }),
            "/products/1",
        );
        expect(callbacks.onNavigate).toHaveBeenNthCalledWith(2, "/products/1");
        expect(framework.didEnterPage).toHaveBeenNthCalledWith(2, productPage);
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
        expect(HistoryMock.latest<{ page: BasePage }>().replaceState).toHaveBeenCalledWith(
            expect.objectContaining({ page: redirectedPage, entryId: expect.any(String) }),
            "/login",
        );

        await handler({ kind: ACTION_KINDS.FLOW, url: "/missing" });
        expect(log.warn).toHaveBeenCalledWith("Navigation did not commit", "not_found");
    });

    test("rewrites beforeLoad URLs before dispatching page data", async () => {
        const canonicalPage = makePage("canonical");
        const { framework, getHandler } = makeFramework({
            routeUrl: vi.fn((url: string) => {
                if (url === "/legacy") {
                    return makeMatch("legacy", () => ({
                        kind: "rewrite",
                        url: "/canonical",
                    }));
                }
                if (url === "/canonical") {
                    return makeMatch("canonical");
                }
                return undefined;
            }),
            dispatch: vi.fn(async () => canonicalPage),
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

        await getHandler()({ kind: ACTION_KINDS.FLOW, url: "/legacy" });
        await expect(updateApp.mock.calls[0][0].page).resolves.toEqual(canonicalPage);

        const history = HistoryMock.latest<{ page: BasePage }>();
        expect(history.replaceState).toHaveBeenCalledWith(
            expect.objectContaining({ page: canonicalPage, entryId: expect.any(String) }),
            "/canonical",
        );
        expect(callbacks.onNavigate).toHaveBeenCalledWith("/canonical");
    });

    test("uses the default scrollable element lookup and stops on beforeLoad denial", async () => {
        const overrideElement = { id: "override" } as HTMLElement;
        const getElementById = vi.fn((id: string) => {
            if (id === "scrollable-page-override") {
                return overrideElement;
            }
            return null;
        });
        vi.stubGlobal("document", {
            cookie: "session=abc",
            documentElement: { scrollTop: 0 },
            getElementById,
        });

        const { framework, getHandler } = makeFramework({
            routeUrl: vi.fn(() =>
                makeMatch("blocked", () => ({
                    kind: "deny",
                    status: 403,
                    message: "nope",
                })),
            ),
        });
        const updateApp = vi.fn();
        const log = makeLogger();

        registerFlowActionHandler({
            framework: framework as never,
            log,
            callbacks: makeCallbacks(),
            updateApp,
        });

        const history = HistoryMock.latest<{ page: BasePage }>();
        expect(history.options.getScrollablePageElement()).toBe(overrideElement);

        await getHandler()({ kind: ACTION_KINDS.FLOW, url: "/blocked" });

        expect(updateApp).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalledWith("Navigation did not commit", "denied");
    });

    test("leaves URL and view unchanged when page loading fails", async () => {
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
        expect(updateApp).not.toHaveBeenCalled();
        expect(history.replaceUrl).not.toHaveBeenCalled();
        expect(callbacks.onNavigate).not.toHaveBeenCalled();
    });

    test("does not expose the loaded page when afterLoad denies the navigation", async () => {
        const deniedPage = makePage("denied");
        const { framework, getHandler } = makeFramework({
            routeUrl: vi.fn(() =>
                makeMatch("denied", undefined, () => ({
                    kind: "deny",
                    status: 403,
                    message: "blocked",
                })),
            ),
            dispatch: vi.fn(async () => deniedPage),
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

        await getHandler()({ kind: ACTION_KINDS.FLOW, url: "/denied" });

        const history = HistoryMock.latest<{ page: BasePage }>();
        expect(updateApp).not.toHaveBeenCalled();
        expect(history.beforeTransition).not.toHaveBeenCalled();
        expect(history.replaceState).not.toHaveBeenCalled();
        expect(history.pushState).not.toHaveBeenCalled();
        expect(callbacks.onNavigate).not.toHaveBeenCalled();
        expect(framework.didEnterPage).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalledWith("Navigation did not commit", "denied");
    });

    test("preserves the previous history entry when a later navigation fails", async () => {
        const homePage = makePage("home");
        const failure = new Error("broken push");
        const { framework, getHandler } = makeFramework({
            routeUrl: vi.fn((url: string) => {
                if (url === "/home") {
                    return makeMatch("home");
                }
                if (url === "/broken") {
                    return makeMatch("broken");
                }
                return undefined;
            }),
            dispatch: vi.fn(async (intent: { id: string }) => {
                if (intent.id === "home") {
                    return homePage;
                }
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

        const handler = getHandler();
        await handler({ kind: ACTION_KINDS.FLOW, url: "/home" });
        await expect(updateApp.mock.calls[0][0].page).resolves.toEqual(homePage);

        await handler({ kind: ACTION_KINDS.FLOW, url: "/broken" });

        const history = HistoryMock.latest<{ page: BasePage }>();
        expect(updateApp).toHaveBeenCalledTimes(1);
        expect(history.pushUrl).not.toHaveBeenCalled();
        expect(callbacks.onNavigate).toHaveBeenCalledTimes(1);
    });

    test("abandons stale navigations before updating the UI", async () => {
        vi.useFakeTimers();
        try {
            const fastPage = makePage("fast");
            const slowPromise = new Promise<BasePage>(() => undefined);
            const { framework, getHandler } = makeFramework({
                routeUrl: vi.fn((url: string) => {
                    if (url === "/slow") {
                        return makeMatch("slow");
                    }
                    if (url === "/fast") {
                        return makeMatch("fast");
                    }
                    return undefined;
                }),
                dispatch: vi.fn(async (intent: { id: string }) =>
                    intent.id === "slow" ? slowPromise : fastPage,
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
            const slowNavigation = handler({
                kind: ACTION_KINDS.FLOW,
                url: "/slow",
            });
            await Promise.resolve();

            await handler({ kind: ACTION_KINDS.FLOW, url: "/fast" });
            await expect(updateApp.mock.calls[0][0].page).resolves.toEqual(fastPage);

            vi.advanceTimersByTime(500);
            await slowNavigation;

            expect(updateApp).toHaveBeenCalledTimes(1);
            expect(framework.didEnterPage).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    test("skips stale page commits and follows afterLoad redirects", async () => {
        vi.useFakeTimers();
        try {
            const slowPage = makePage("slow");
            const redirectPage = makePage("redirected");
            const finalPage = makePage("final");
            const slowDeferred = createDeferred<BasePage>();
            const { framework, getHandler } = makeFramework({
                routeUrl: vi.fn((url: string) => {
                    if (url === "/slow") {
                        return makeMatch("slow");
                    }
                    if (url === "/redirect") {
                        return makeMatch("redirect", undefined, () => ({
                            kind: "redirect",
                            url: "/final",
                        }));
                    }
                    if (url === "/final") {
                        return makeMatch("final");
                    }
                    return undefined;
                }),
                dispatch: vi.fn(async (intent: { id: string }) => {
                    if (intent.id === "slow") {
                        return slowDeferred.promise;
                    }
                    if (intent.id === "redirect") {
                        return redirectPage;
                    }
                    return finalPage;
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

            const handler = getHandler();
            const slowNavigation = handler({
                kind: ACTION_KINDS.FLOW,
                url: "/slow",
            });
            await Promise.resolve();
            await vi.advanceTimersByTimeAsync(500);

            expect(updateApp).toHaveBeenCalledTimes(1);

            await handler({ kind: ACTION_KINDS.FLOW, url: "/redirect" });
            await expect(updateApp.mock.calls[1][0].page).resolves.toEqual(finalPage);
            expect(updateApp).toHaveBeenCalledTimes(2);
            slowDeferred.resolve(slowPage);
            await slowNavigation;
            await expect(updateApp.mock.calls[0][0].page).rejects.toMatchObject({
                code: "cancelled",
            });
            const history = HistoryMock.latest<{ page: BasePage }>();
            expect(history.replaceState).toHaveBeenCalledTimes(1);
            expect(history.pushState).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    test("handles popstate with cached pages and unroutable URLs", async () => {
        const page = makePage("cached");
        const { framework } = makeFramework({
            routeUrl: vi.fn((url: string) => (url === "/back" ? makeMatch("cached") : undefined)),
            dispatch: vi.fn(async () => page),
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
        await expect(updateApp.mock.calls[0][0].page).resolves.toEqual(page);
        expect(framework.didEnterPage).toHaveBeenNthCalledWith(1, page);

        await history.popListener?.("https://app.example/missing", undefined);

        expect(callbacks.onNavigate).toHaveBeenCalledTimes(1);
        expect(updateApp).toHaveBeenCalledTimes(1);
        expect(framework.didEnterPage).toHaveBeenCalledTimes(1);
        expect(log.warn).toHaveBeenCalledWith("Navigation did not commit", "not_found");
    });

    test("keeps uncached popstate pending until the target page is ready", async () => {
        vi.useFakeTimers();
        try {
            const page = makePage("delayed");
            const deferred = createDeferred<BasePage>();
            const { framework } = makeFramework({
                routeUrl: vi.fn(() => makeMatch("delayed")),
                dispatch: vi.fn(() => deferred.promise),
            });
            const updateApp = vi.fn();

            registerFlowActionHandler({
                framework: framework as never,
                log: makeLogger(),
                callbacks: makeCallbacks(),
                updateApp,
                getScrollablePageElement: vi.fn(() => null),
            });

            const listener = HistoryMock.latest<{ page: BasePage }>().popListener;
            const navigation = listener?.("https://app.example/delayed", undefined);
            let navigationFinished = false;
            void Promise.resolve(navigation).then(() => {
                navigationFinished = true;
            });

            await vi.advanceTimersByTimeAsync(500);

            expect(updateApp).toHaveBeenCalledTimes(1);
            expect(navigationFinished).toBe(false);

            deferred.resolve(page);
            await navigation;

            expect(navigationFinished).toBe(true);
            await expect(updateApp.mock.calls[0][0].page).resolves.toEqual(page);
        } finally {
            vi.useRealTimers();
        }
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
        expect(log.warn).toHaveBeenCalledWith("Navigation did not commit", "configuration");
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
        expect(history.replaceState).toHaveBeenCalledWith(
            expect.objectContaining({ page: loginPage, entryId: expect.any(String) }),
            "/login",
        );
        expect(history.pushState).not.toHaveBeenCalled();
        expect(
            (window.history as unknown as { replaceState: ReturnType<typeof vi.fn> }).replaceState,
        ).toHaveBeenCalledWith({ id: "history-entry" }, "", "/profile");
        expect(callbacks.onNavigate.mock.calls).toEqual([["/login"], ["/profile"]]);
        expect(updateApp).toHaveBeenCalledTimes(2);
        expect(log.warn).toHaveBeenCalledWith("Navigation did not commit", "denied");
    });

    test("runs afterLoad guards on popstate (regression: previously skipped)", async () => {
        const page = makePage("article");
        const { framework } = makeFramework({
            routeUrl: vi.fn(() =>
                makeMatch("article", undefined, () => ({ kind: "deny", status: 403 })),
            ),
            dispatch: vi.fn(async () => page),
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
            "https://app.example/article",
            undefined,
        );
        // Denied data is never handed to the view.
        expect(updateApp).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalledWith("Navigation did not commit", "denied");
        expect(framework.didEnterPage).not.toHaveBeenCalled();
    });

    test("popstate afterLoad rewrite canonicalizes URL without starting a new navigation", async () => {
        const page = makePage("article");
        const dispatch = vi.fn(async () => page);
        const { framework } = makeFramework({
            routeUrl: vi.fn(() =>
                makeMatch("article", undefined, () => ({
                    kind: "rewrite",
                    url: "/articles/canonical",
                })),
            ),
            dispatch,
        });
        const callbacks = makeCallbacks();
        const updateApp = vi.fn();
        const log = makeLogger();

        // 扩展 window stub 以包含 history.state + replaceState
        const replaceStateSpy = vi.fn();
        vi.stubGlobal("window", {
            location: {
                pathname: "/article",
                search: "",
                origin: "https://app.example",
                href: "https://app.example/article",
            },
            addEventListener: vi.fn(),
            history: {
                state: { id: "prev-state-id" },
                replaceState: replaceStateSpy,
            },
        });

        registerFlowActionHandler({
            framework: framework as never,
            log,
            callbacks,
            updateApp,
            getScrollablePageElement: vi.fn(() => null),
        });

        await HistoryMock.latest<{ page: BasePage }>().popListener?.(
            "https://app.example/article",
            undefined,
        );
        await expect(updateApp.mock.calls[0][0].page).resolves.toEqual(page);

        // 关键回归：rewrite 不触发二次 dispatch
        expect(dispatch).toHaveBeenCalledTimes(1);
        // 用 replaceState 保留 state.id（不 push 新 entry）
        expect(replaceStateSpy).toHaveBeenCalledWith(
            { id: "prev-state-id" },
            "",
            "/articles/canonical",
        );
        // onNavigate 收到 canonical URL（顶部已用原 URL 调过一次，rewrite 再覆盖）
        expect(callbacks.onNavigate).toHaveBeenLastCalledWith("/articles/canonical");
        // didEnterPage 仍执行（page 数据有效）
        expect(framework.didEnterPage).toHaveBeenCalledWith(page);
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

    test("default manages history (creates a History instance + popstate)", () => {
        const { framework } = makeFramework({
            routeUrl: vi.fn(() => makeMatch("home")),
            dispatch: vi.fn(async () => makePage("home")),
        });
        registerFlowActionHandler({
            framework: framework as never,
            log: makeLogger(),
            callbacks: makeCallbacks(),
            updateApp: vi.fn(),
        });
        expect(HistoryMock.instances).toHaveLength(1);
        expect(HistoryMock.latest().onPopState).toHaveBeenCalledTimes(1);
    });

    test("manageHistory:false skips history (nav bridge owns it) but still dispatches + renders", async () => {
        const page = makePage("home");
        const { framework, getHandler } = makeFramework({
            routeUrl: vi.fn(() => makeMatch("home")),
            dispatch: vi.fn(async () => page),
        });
        const updateApp = vi.fn();
        registerFlowActionHandler({
            framework: framework as never,
            log: makeLogger(),
            callbacks: makeCallbacks(),
            updateApp,
            manageHistory: false,
        });

        // 不建 History 实例 → 不注册 popstate、不 pushState（避免与 NavigationBridge 争抢 window.history.state）。
        expect(HistoryMock.instances).toHaveLength(0);

        // handler 仍工作：FlowAction 照常 dispatch + updateApp（初始渲染 / redirect）。
        await getHandler()({ kind: ACTION_KINDS.FLOW, url: "/home" });
        expect(updateApp).toHaveBeenCalled();
        expect(HistoryMock.instances).toHaveLength(0);
    });
});

function makeFramework(overrides: Partial<Record<string, unknown>> = {}) {
    const actionHandlers = new Map<string, (action: Record<string, unknown>) => Promise<void>>();
    const owner = Framework.create();
    const framework = {
        container: owner.container,
        prefetchedIntents: owner.prefetchedIntents,
        createExecution: owner.createExecution.bind(owner),
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

function createDeferred<T>(): {
    promise: Promise<T>;
    resolve(value: T): void;
} {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((innerResolve) => {
        resolve = innerResolve;
    });

    return { promise, resolve };
}
