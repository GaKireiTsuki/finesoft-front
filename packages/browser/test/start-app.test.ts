import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { Framework } from "../../core/src/index.ts";

const { registerActionHandlers } = vi.hoisted(() => ({
    registerActionHandlers: vi.fn(),
}));

vi.mock("../src/action-handlers/register", () => ({
    registerActionHandlers,
}));

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import { startBrowserApp } from "../src/start-app";

describe("startBrowserApp", () => {
    const target = {} as HTMLElement;

    beforeEach(() => {
        registerActionHandlers.mockReset();
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.stubGlobal(
            "fetch",
            vi.fn(
                async () =>
                    new Response("{}", {
                        headers: { "Content-Type": "application/json" },
                    }),
            ),
        );
        vi.stubGlobal("window", {
            location: {
                pathname: "/",
                search: "",
                origin: "https://example.com",
            },
        });
        vi.stubGlobal("document", {
            documentElement: {
                lang: "",
                dir: "",
            },
            getElementById: vi.fn((id: string) => (id === "app" ? target : null)),
        });
    });

    afterEach(() => {
        globalThis.__FINESOFT_I18N_LOADER__ = undefined;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    test("waits for async messages before mount and exposes translator on first render", async () => {
        const events: string[] = [];
        let releaseMessages: ((messages: Record<string, string>) => void) | undefined;
        let capturedFramework: Framework | undefined;

        const loadMessages = vi.fn(
            () =>
                new Promise<Record<string, string>>((resolve) => {
                    events.push("loader:start");
                    releaseMessages = (messages) => {
                        events.push("loader:end");
                        resolve(messages);
                    };
                }),
        );
        const mount = vi.fn((_target: HTMLElement, context: { framework: Framework }) => {
            events.push("mount");
            capturedFramework = context.framework;
            return vi.fn();
        });

        const startPromise = startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/", "home");
            },
            mount,
            callbacks: makeCallbacks(),
            frameworkConfig: {
                locale: "en-US",
            },
            loadMessages,
        });

        await Promise.resolve();

        expect(loadMessages).toHaveBeenCalledWith(
            "en-US",
            expect.objectContaining({
                runtime: "browser",
                url: "/",
                fetch: expect.any(Function),
            }),
        );
        expect(mount).not.toHaveBeenCalled();

        releaseMessages?.({ hello: "Hello" });
        await startPromise;

        expect(events).toEqual(["loader:start", "loader:end", "mount"]);
        expect(mount).toHaveBeenCalledTimes(1);
        expect(capturedFramework?.getTranslator()?.t("hello")).toBe("Hello");
    });

    test("falls back to <html lang> when frameworkConfig.locale is missing", async () => {
        const documentElement = getDocumentElement();
        documentElement.lang = "fr-FR";
        let capturedFramework: Framework | undefined;

        await startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/", "home");
            },
            mount(_target, context) {
                capturedFramework = context.framework;
                return vi.fn();
            },
            callbacks: makeCallbacks(),
            loadMessages: vi.fn(async (locale) => {
                expect(locale).toBe("fr-FR");
                return { hello: "Bonjour" };
            }),
        });

        expect(capturedFramework?.getLocale()?.lang).toBe("fr-FR");
        expect(capturedFramework?.getTranslator()?.t("hello")).toBe("Bonjour");
    });

    test("does not create a translator when no external dictionary is configured", async () => {
        let capturedFramework: Framework | undefined;

        await startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/", "home");
            },
            mount(_target, context) {
                capturedFramework = context.framework;
                return vi.fn();
            },
            callbacks: makeCallbacks(),
            frameworkConfig: {
                locale: "en-US",
            },
        });

        expect(capturedFramework?.getTranslator()).toBeUndefined();
    });

    test("uses the Vite-generated loader when loadMessages is omitted", async () => {
        let capturedFramework: Framework | undefined;
        globalThis.__FINESOFT_I18N_LOADER__ = vi.fn(async (locale) => {
            expect(locale).toBe("en-US");
            return { hello: "Hello from generated loader" };
        });

        await startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/", "home");
            },
            mount(_target, context) {
                capturedFramework = context.framework;
                return vi.fn();
            },
            callbacks: makeCallbacks(),
            frameworkConfig: {
                locale: "en-US",
            },
        });

        expect(capturedFramework?.getTranslator()?.t("hello")).toBe("Hello from generated loader");
    });

    test("rejects startup when loadMessages fails before mount", async () => {
        const mount = vi.fn();

        await expect(
            startBrowserApp({
                bootstrap(framework) {
                    framework.router.add("/", "home");
                },
                mount,
                callbacks: makeCallbacks(),
                frameworkConfig: {
                    locale: "en-US",
                },
                loadMessages: vi.fn(async () => {
                    throw new Error("failed to load messages");
                }),
            }),
        ).rejects.toThrow("failed to load messages");

        expect(mount).not.toHaveBeenCalled();
    });

    test("runs lifecycle hooks and surfaces a 404 page when the initial route is missing", async () => {
        const events: string[] = [];
        const updateApp = vi.fn((props: { page: Promise<unknown>; isFirstPage?: boolean }) => {
            events.push("update");
            return props;
        });

        await startBrowserApp({
            bootstrap() {},
            mount() {
                events.push("mount");
                return updateApp as never;
            },
            callbacks: makeCallbacks(),
            onBeforeStart() {
                events.push("before");
            },
            onAfterStart() {
                events.push("after");
            },
        });

        expect(events).toEqual(["before", "mount", "update", "after"]);
        expect(updateApp).toHaveBeenCalledWith({
            page: expect.any(Promise),
            isFirstPage: true,
        });
        await expect(updateApp.mock.calls[0][0].page).rejects.toThrow("404");
    });

    test("rejects when translated startup work has no fetch implementation available", async () => {
        vi.stubGlobal("fetch", undefined);

        await expect(
            startBrowserApp({
                bootstrap() {},
                mount() {
                    return vi.fn();
                },
                callbacks: makeCallbacks(),
                frameworkConfig: {
                    locale: "en-US",
                },
                loadMessages: vi.fn(async (_locale, loaderContext) => {
                    await loaderContext.fetch("https://example.com/messages.json");
                    return {};
                }),
            }),
        ).rejects.toThrow("[startBrowserApp] loadMessages requires a fetch implementation.");
    });

    test("rejects when the configured mount target does not exist", async () => {
        vi.stubGlobal("document", {
            documentElement: {
                lang: "",
                dir: "",
            },
            getElementById: vi.fn(() => null),
        });

        await expect(
            startBrowserApp({
                bootstrap(framework) {
                    framework.router.add("/", "home");
                },
                mount() {
                    return vi.fn();
                },
                callbacks: makeCallbacks(),
            }),
        ).rejects.toThrow("[startBrowserApp] Mount target not found: #app.");
    });
});

function makeCallbacks() {
    return {
        onNavigate: vi.fn(),
        onModal: vi.fn(),
    };
}

function getDocumentElement(): { lang: string; dir: string } {
    return (document as { documentElement: { lang: string; dir: string } }).documentElement;
}
