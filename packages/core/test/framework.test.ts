import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { ACTION_KINDS } from "../src/actions/types";
import { DEP_KEYS } from "../src/dependencies/make-dependencies";
import { Framework } from "../src/framework";
import { next, redirect } from "../src/middleware/types";
import { PrefetchedIntents } from "../src/prefetched-intents/prefetched-intents";
import type { Router } from "../src/router/router";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("Framework", () => {
    test("dispatches prefetched intents without invoking controllers", async () => {
        const page = makePage("cached");
        const controller = {
            intentId: "cached",
            perform: vi.fn(() => {
                throw new Error("should not run");
            }),
        };
        const framework = Framework.create({
            prefetchedIntents: PrefetchedIntents.fromArray([
                {
                    intent: { id: "cached", params: { page: "1" } },
                    data: page,
                },
            ]),
        });
        framework.registerIntent(controller);

        await expect(framework.dispatch({ id: "cached", params: { page: "1" } })).resolves.toBe(
            page,
        );
        expect(controller.perform).not.toHaveBeenCalled();
    });

    test("creates routes, dispatches intents, performs actions, and exposes configured services", async () => {
        const framework = Framework.create({
            locale: "en-US",
            platform: {
                os: "macos",
                browser: "chrome",
                engine: "blink",
                isMobile: false,
                isTouch: false,
            },
            _resolvedMessages: { hello: "Hello" },
            setupRoutes(router: Router) {
                router.add("/", "home");
            },
        } as never);
        const controller = {
            intentId: "home",
            perform: vi.fn(() => makePage("home")),
        };
        const actionHandler = vi.fn();
        const metrics = {
            record: vi.fn(),
            recordPageView: vi.fn(),
            recordEvent: vi.fn(),
        };

        framework.registerIntent(controller);
        framework.onAction(ACTION_KINDS.EXTERNAL_URL, actionHandler);
        framework.container.register(DEP_KEYS.METRICS, () => metrics);

        await expect(framework.dispatch({ id: "home" })).resolves.toEqual(makePage("home"));
        await framework.perform({
            kind: ACTION_KINDS.EXTERNAL_URL,
            url: "https://example.com",
        });
        framework.didEnterPage(makePage("home"));

        expect(controller.perform).toHaveBeenCalled();
        expect(actionHandler).toHaveBeenCalledWith({
            kind: ACTION_KINDS.EXTERNAL_URL,
            url: "https://example.com",
        });
        expect(framework.routeUrl("/")?.intent).toEqual({
            id: "home",
            params: {},
        });
        expect(metrics.recordPageView).toHaveBeenCalledWith("page", {
            pageId: "home",
            title: "Page home",
        });
        expect(framework.getLocale()).toEqual({ lang: "en-US", dir: "ltr" });
        expect(framework.getTranslator()?.t("hello")).toBe("Hello");
        expect(framework.getPlatform()).toEqual({
            os: "macos",
            browser: "chrome",
            engine: "blink",
            isMobile: false,
            isTouch: false,
        });
    });

    test("runs global and route-level guards in order", async () => {
        const framework = Framework.create();
        const beforeGlobal = vi.fn(async () => next());
        const beforeRoute = vi.fn(async () => redirect("/login"));
        const afterGlobal = vi.fn(async () => next());
        const afterRoute = vi.fn(async () => redirect("/done"));

        framework.beforeLoad(beforeGlobal);
        framework.afterLoad(afterGlobal);

        const navigationContext = {
            url: "/account",
            path: "/account",
            params: {},
            intent: { id: "account" },
            isServer: false,
            container: framework.container,
            getCookie: () => undefined,
            getHeader: () => undefined,
        };

        await expect(framework.runBeforeLoad(navigationContext, [beforeRoute])).resolves.toEqual({
            kind: "redirect",
            url: "/login",
            status: 302,
        });
        await expect(
            framework.runAfterLoad(
                {
                    ...navigationContext,
                    page: makePage("account"),
                },
                [afterRoute],
            ),
        ).resolves.toEqual({
            kind: "redirect",
            url: "/done",
            status: 302,
        });
        expect(beforeGlobal.mock.invocationCallOrder[0]).toBeLessThan(
            beforeRoute.mock.invocationCallOrder[0],
        );
        expect(afterGlobal.mock.invocationCallOrder[0]).toBeLessThan(
            afterRoute.mock.invocationCallOrder[0],
        );
    });

    test("disposes the container", () => {
        const framework = Framework.create();

        framework.dispose();

        expect(framework.container.has(DEP_KEYS.LOGGER)).toBe(false);
    });
});

function makePage(id: string) {
    return {
        id,
        pageType: "page",
        title: `Page ${id}`,
    };
}
