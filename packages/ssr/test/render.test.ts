import { DEP_KEYS, HostGuardError } from "../../core/src/index";
vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { BasePage } from "@finesoft/web";
import type { IntentController } from "@finesoft/core";
import { defineRoutes } from "@finesoft/web";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import { ssrRender } from "../src/render";

describe("ssrRender", () => {
    afterEach(() => {
        globalThis.__FINESOFT_I18N_LOADER__ = undefined;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    test("SSR installs the host resolver in the request's protected fetch", async () => {
        const fetch = vi.fn(async () => new Response("ok"));
        const lookup = vi.fn(async () => ["127.0.0.1"]);
        let safeFetch: typeof globalThis.fetch | undefined;
        await ssrRender({
            url: "/",
            frameworkConfig: {},
            ssrContext: { fetch, safeFetch: { lookup } },
            bootstrap(framework) {
                safeFetch = framework.container.resolve(DEP_KEYS.SAFE_FETCH);
                defineRoutes(framework, [
                    { path: "/", intentId: "home", controller: makeController(makePage()) },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp() {
                return { html: "ok", head: "", css: "" };
            },
        });
        await expect(safeFetch!("https://example.com")).rejects.toBeInstanceOf(HostGuardError);
        expect(lookup).toHaveBeenCalledWith("example.com");
        expect(fetch).not.toHaveBeenCalled();
    });

    test("uses the Vite-generated loader when loadMessages is omitted", async () => {
        globalThis.__FINESOFT_I18N_LOADER__ = vi.fn(async (locale) => {
            expect(locale).toBe("en-US");
            return { hello: "Hello from generated loader" };
        });

        const result = await ssrRender({
            url: "/",
            frameworkConfig: {
                locale: "en-US",
            },
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/",
                        intentId: "home",
                        controller: makeController(makePage()),
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp(_page, framework) {
                return {
                    html: framework.getTranslator()?.t("hello") ?? "missing",
                    head: "",
                    css: "",
                };
            },
        });

        expect(result.html).toBe("Hello from generated loader");
    });

    test("loads async messages before renderApp and makes translator available", async () => {
        const page = makePage();
        const loadMessages = vi.fn(async () => ({ hello: "Hello" }));

        const result = await ssrRender({
            url: "/?from=test",
            frameworkConfig: {
                locale: "en-US",
            },
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/",
                        intentId: "home",
                        controller: makeController(page),
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp(_page, framework) {
                return {
                    html: framework.getTranslator()?.t("hello") ?? "missing",
                    head: "",
                    css: "",
                };
            },
            loadMessages,
        });

        expect(loadMessages).toHaveBeenCalledWith(
            "en-US",
            expect.objectContaining({
                runtime: "server",
                url: "/?from=test",
                fetch: expect.any(Function),
            }),
        );
        expect(result.html).toBe("Hello");
        expect(result.serverData).toEqual([
            {
                entryId: expect.any(String),
                intent: {
                    id: "home",
                    params: {
                        from: "test",
                    },
                },
                data: page,
            },
        ]);
    });

    test("uses resolveLocale output when calling loadMessages", async () => {
        const request = new Request("https://example.com/zh-Hans");
        const internalFetch = vi.fn(async () => new Response("{}", { status: 200 }));
        const loadMessages = vi.fn(async () => ({
            "zh-Hans": {
                hello: "你好",
            },
        }));

        const result = await ssrRender({
            url: "/zh-Hans",
            frameworkConfig: {
                locale: "en-US",
            },
            ssrContext: {
                fetch: internalFetch,
                request,
            },
            resolveLocale() {
                return { lang: "zh-Hans", dir: "ltr" };
            },
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/zh-Hans",
                        intentId: "home",
                        controller: makeController(makePage()),
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp(_page, framework) {
                return {
                    html: framework.getTranslator()?.t("hello") ?? "missing",
                    head: "",
                    css: "",
                };
            },
            loadMessages,
        });

        expect(loadMessages).toHaveBeenCalledWith(
            "zh-Hans",
            expect.objectContaining({
                runtime: "server",
                url: "/zh-Hans",
                fetch: internalFetch,
                request,
            }),
        );
        expect(result.html).toBe("你好");
        expect(result.locale).toEqual({ lang: "zh-Hans", dir: "ltr" });
    });

    test("does not create a translator when no external dictionary is configured", async () => {
        const page = makePage();

        const result = await ssrRender({
            url: "/",
            frameworkConfig: {
                locale: "en-US",
            },
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/",
                        intentId: "home",
                        controller: makeController(page),
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp(_page, framework) {
                return {
                    html: framework.getTranslator()?.t("hello") ?? "missing",
                    head: "",
                    css: "",
                };
            },
        });

        expect(result.html).toBe("missing");
        expect(result.serverData).toEqual([
            {
                entryId: expect.any(String),
                intent: {
                    id: "home",
                    params: {},
                },
                data: page,
            },
        ]);
    });

    test("propagates loadMessages failures", async () => {
        await expect(
            ssrRender({
                url: "/",
                frameworkConfig: {
                    locale: "en-US",
                },
                bootstrap() {},
                getErrorPage: makeErrorPage,
                renderApp() {
                    return { html: "", head: "", css: "" };
                },
                loadMessages: vi.fn(async () => {
                    throw new Error("failed to load messages");
                }),
            }),
        ).rejects.toThrow("failed to load messages");
    });

    test("throws when loadMessages needs fetch but no fetch implementation exists", async () => {
        vi.stubGlobal("fetch", undefined);

        await expect(
            ssrRender({
                url: "/",
                frameworkConfig: {
                    locale: "en-US",
                },
                bootstrap() {},
                getErrorPage: makeErrorPage,
                renderApp() {
                    return { html: "", head: "", css: "" };
                },
                loadMessages: vi.fn(async (_locale, context) => {
                    await context.fetch("https://example.com/messages");
                    return { hello: "never reached" };
                }),
            }),
        ).rejects.toThrow("[ssrRender] loadMessages requires a fetch implementation.");
    });

    test("returns an empty shell for CSR routes without rendering on the server", async () => {
        const renderApp = vi.fn();

        const result = await ssrRender({
            url: "/",
            frameworkConfig: {},
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/",
                        intentId: "home",
                        controller: makeController(makePage()),
                        renderMode: "csr",
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp,
        });

        expect(result).toEqual({
            html: "",
            head: "",
            css: "",
            serverData: [],
            renderMode: "csr",
        });
        expect(renderApp).not.toHaveBeenCalled();
    });

    test("short-circuits with a redirect when beforeLoad blocks the request", async () => {
        const renderApp = vi.fn();

        const result = await ssrRender({
            url: "/private",
            frameworkConfig: {},
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/private",
                        intentId: "private",
                        controller: makeController(makePage()),
                        beforeLoad: [
                            () => ({
                                kind: "redirect",
                                url: "/login",
                                status: 302,
                            }),
                        ],
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp,
        });

        expect(result).toEqual({
            html: "",
            head: "",
            css: "",
            serverData: [],
            redirect: { url: "/login", status: 302 },
        });
        expect(renderApp).not.toHaveBeenCalled();
    });

    test("renders an error page when beforeLoad denies access", async () => {
        const renderApp = vi.fn((page: BasePage) => ({
            html: page.title,
            head: '<meta name="robots" content="noindex">',
            css: ".error {}",
            slots: { banner: "blocked" },
        }));

        const result = await ssrRender({
            url: "/private",
            frameworkConfig: {},
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/private",
                        intentId: "private",
                        controller: makeController(makePage()),
                        beforeLoad: [
                            () => ({
                                kind: "deny",
                                status: 403,
                                message: "Forbidden zone",
                            }),
                        ],
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp,
        });

        expect(result).toEqual({
            html: "Forbidden zone",
            head: '<meta name="robots" content="noindex">',
            css: ".error {}",
            serverData: [],
            slots: { banner: "blocked" },
            status: 403,
        });
    });

    test("afterLoad rewrite renders the current page and exposes rewriteUrl (no HTTP redirect)", async () => {
        const page: BasePage = { id: "product-1", pageType: "product", title: "product-1" };
        const renderApp = vi.fn((p: BasePage) => ({
            html: p.title,
            head: "",
            css: "",
        }));

        const result = await ssrRender({
            url: "/products?id=1",
            frameworkConfig: {},
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/products",
                        intentId: "product",
                        controller: makeController(page, "product"),
                        afterLoad: [() => ({ kind: "rewrite", url: "/products/1" })],
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp,
        });

        // 已加载的 page 正常渲染，rewriteUrl 仅作元信息暴露
        expect(result.html).toBe("product-1");
        expect(result.rewriteUrl).toBe("/products/1");
        expect(result.redirect).toBeUndefined();
        expect(renderApp).toHaveBeenCalledTimes(1);
    });

    test("beforeLoad rewrite internally re-routes to the new URL (regression: previously emitted 301)", async () => {
        const legacyController = vi.fn();
        const canonicalPage: BasePage = {
            id: "canonical-page",
            pageType: "canonical",
            title: "canonical-page",
        };
        const canonicalController = vi.fn(async () => canonicalPage);
        const renderApp = vi.fn((p: BasePage) => ({
            html: p.title,
            head: "",
            css: "",
        }));

        const result = await ssrRender({
            url: "/legacy",
            frameworkConfig: {},
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/legacy",
                        intentId: "legacy",
                        controller: {
                            intentId: "legacy",
                            perform: legacyController,
                        },
                        beforeLoad: [() => ({ kind: "rewrite", url: "/canonical" })],
                    },
                    {
                        path: "/canonical",
                        intentId: "canonical",
                        controller: {
                            intentId: "canonical",
                            perform: canonicalController,
                        },
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp,
        });

        // /legacy 的 controller 被跳过，/canonical 的 controller 被调用并渲染
        expect(legacyController).not.toHaveBeenCalled();
        expect(canonicalController).toHaveBeenCalledTimes(1);
        expect(result.html).toBe("canonical-page");
        expect(result.redirect).toBeUndefined();
        // beforeLoad rewrite 是完整重路由（不是 afterLoad rewrite），不设置 rewriteUrl
        expect(result.rewriteUrl).toBeUndefined();
    });

    test("aborts on rewrite recursion to prevent infinite loops", async () => {
        await expect(
            ssrRender({
                url: "/a",
                frameworkConfig: {},
                bootstrap(framework) {
                    defineRoutes(framework, [
                        {
                            path: "/a",
                            intentId: "a",
                            controller: makeController(makePage(), "a"),
                            beforeLoad: [() => ({ kind: "rewrite", url: "/b" })],
                        },
                        {
                            path: "/b",
                            intentId: "b",
                            controller: makeController(makePage(), "b"),
                            beforeLoad: [() => ({ kind: "rewrite", url: "/a" })],
                        },
                    ]);
                },
                getErrorPage: makeErrorPage,
                renderApp: () => ({ html: "", head: "", css: "" }),
            }),
        ).rejects.toThrow(/rewrite recursion depth exceeded/i);
    });

    test("renders a 404 page when no route matches", async () => {
        const renderApp = vi.fn((page: BasePage) => ({
            html: page.title,
            head: "",
            css: "",
        }));

        const result = await ssrRender({
            url: "/missing",
            frameworkConfig: {},
            bootstrap() {},
            getErrorPage: makeErrorPage,
            renderApp,
        });

        expect(result).toMatchObject({
            status: 404,
            html: "Page not found",
            head: "",
            css: "",
            serverData: [],
            renderMode: undefined,
            slots: undefined,
            locale: undefined,
        });
        expect(renderApp).toHaveBeenCalledTimes(1);
    });

    test("falls back to a 500 error page when dispatch fails", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const renderApp = vi.fn((page: BasePage) => ({
            html: page.title,
            head: "",
            css: "",
        }));

        const result = await ssrRender({
            url: "/broken",
            frameworkConfig: {},
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/broken",
                        intentId: "broken",
                        controller: {
                            intentId: "broken",
                            perform() {
                                throw new Error("boom");
                            },
                        },
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp,
        });

        expect(result).toMatchObject({
            status: 500,
            html: "Execution failed",
            head: "",
            css: "",
            serverData: [],
            renderMode: undefined,
            slots: undefined,
            locale: undefined,
        });
        // Runtime emits classified operation records; raw controller errors are not logged here.
        expect(errorSpy).not.toHaveBeenCalled();
    });
});

function makeController(page: BasePage, intentId = "home"): IntentController<BasePage> {
    return {
        intentId,
        perform() {
            return page;
        },
    };
}

function makeErrorPage(status: number, message: string): BasePage {
    return {
        id: `error-${status}`,
        pageType: "error",
        title: message,
    };
}

function makePage(): BasePage {
    return {
        id: "home",
        pageType: "test",
        title: "Home",
    };
}
