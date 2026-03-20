import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { BasePage, IntentController } from "../../core/src/index.ts";
import { defineRoutes } from "../../core/src/index.ts";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import { ssrRender } from "./render";

describe("ssrRender", () => {
    afterEach(() => {
        globalThis.__FINESOFT_I18N_LOADER__ = undefined;
        vi.restoreAllMocks();
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
});

function makeController(page: BasePage): IntentController<BasePage> {
    return {
        intentId: "home",
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
