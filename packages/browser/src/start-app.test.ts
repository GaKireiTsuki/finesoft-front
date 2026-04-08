import { defineBootstrap, type Framework } from "../../core/src/index.ts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

const { registerActionHandlers } = vi.hoisted(() => ({
    registerActionHandlers: vi.fn(),
}));

vi.mock("./action-handlers/register", () => ({
    registerActionHandlers,
}));

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import { startBrowserApp } from "./start-app";

describe("startBrowserApp", () => {
    const target = {} as HTMLElement;

    beforeEach(() => {
        registerActionHandlers.mockReset();
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.stubGlobal(
            "fetch",
            vi.fn(
                async () => new Response("{}", { headers: { "Content-Type": "application/json" } }),
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

    test("inherits frameworkConfig and loadMessages from bootstrap defaults", async () => {
        let capturedFramework: Framework | undefined;

        const bootstrap = defineBootstrap(
            {
                frameworkConfig: {
                    locale: "ja-JP",
                },
                loadMessages: vi.fn(async (locale) => {
                    expect(locale).toBe("ja-JP");
                    return { hello: "こんにちは" };
                }),
            },
            (framework) => {
                framework.router.add("/", "home");
            },
        );

        await startBrowserApp({
            bootstrap,
            mount(_target, context) {
                capturedFramework = context.framework;
                return vi.fn();
            },
            callbacks: makeCallbacks(),
        });

        expect(capturedFramework?.getLocale()?.lang).toBe("ja-JP");
        expect(capturedFramework?.getTranslator()?.t("hello")).toBe("こんにちは");
    });

    test("explicit browser loadMessages overrides bootstrap defaults", async () => {
        let capturedFramework: Framework | undefined;
        const explicitLoadMessages = vi.fn(async (locale: string) => {
            expect(locale).toBe("en-US");
            return { hello: "Hello override" };
        });

        const bootstrap = defineBootstrap(
            {
                frameworkConfig: {
                    locale: "ja-JP",
                },
                loadMessages: vi.fn(async () => ({ hello: "こんにちは" })),
            },
            (framework) => {
                framework.router.add("/", "home");
            },
        );

        await startBrowserApp({
            bootstrap,
            frameworkConfig: {
                locale: "en-US",
            },
            loadMessages: explicitLoadMessages,
            mount(_target, context) {
                capturedFramework = context.framework;
                return vi.fn();
            },
            callbacks: makeCallbacks(),
        });

        expect(capturedFramework?.getLocale()?.lang).toBe("en-US");
        expect(capturedFramework?.getTranslator()?.t("hello")).toBe("Hello override");
        expect(explicitLoadMessages).toHaveBeenCalledTimes(1);
    });

    test("exposes the keepAlive controller to mount callbacks", async () => {
        let keepAliveMethods: string[] = [];

        await startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/", "home");
            },
            mount(_target, context) {
                keepAliveMethods = [
                    typeof context.keepAlive.markCacheable,
                    typeof context.keepAlive.evict,
                    typeof context.keepAlive.evictAll,
                ];
                return vi.fn();
            },
            callbacks: makeCallbacks(),
        });

        expect(keepAliveMethods).toEqual(["function", "function", "function"]);
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
