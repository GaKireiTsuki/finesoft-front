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
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
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

    test("activates the navigation bridge and hands a working handle to onNavigationReady", async () => {
        const { leaf, stack, BaseController } = await import("../../core/src/index.ts");

        // 真实 History 需要 window.history 写入面；popstate 通过 addEventListener 注册。
        const popListeners = new Map<string, (event: PopStateEvent) => void>();
        vi.stubGlobal("window", {
            location: {
                pathname: "/home",
                search: "",
                origin: "https://example.com",
                href: "https://example.com/home",
            },
            history: {
                state: null as { id?: string } | null,
                replaceState: vi.fn(),
                pushState: vi.fn(),
            },
            addEventListener: vi.fn((type: string, listener: (event: PopStateEvent) => void) => {
                popListeners.set(type, listener);
            }),
        });

        class HomeController extends BaseController<Record<string, never>, { id: string }> {
            readonly intentId = "home";
            execute(): { id: string } {
                return { id: "home-page" };
            }
        }

        let handle: import("../src/navigation-bridge").NavigationHandle | undefined;

        await startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/home", "home");
                framework.registerIntent(new HomeController());
            },
            mount() {
                return vi.fn();
            },
            callbacks: makeCallbacks(),
            navigation: {
                initial: stack([leaf("home")]),
            },
            onNavigationReady(received) {
                handle = received;
            },
        });

        expect(handle).toBeDefined();
        // 首屏已解析：快照含一个可见目标（home），page 来自 controller。
        const snapshot = handle?.getSnapshot();
        expect(snapshot?.tree).toEqual(stack([leaf("home")]));
        expect(snapshot?.destinations).toHaveLength(1);
        expect(snapshot?.destinations[0]?.intent).toBe("home");
        expect((snapshot?.destinations[0]?.page as { id?: string })?.id).toBe("home-page");
        // bridge 已用 replaceState 写入首屏树（first-page，不污染历史栈）。
        const historyApi = window.history as unknown as { replaceState: ReturnType<typeof vi.fn> };
        expect(historyApi.replaceState).toHaveBeenCalled();
        expect(historyApi.replaceState.mock.calls.at(-1)?.[2]).toBe("/home");
        // popstate listener 已注册（bridge 装配）。
        expect(popListeners.has("popstate")).toBe(true);
    });

    test("does not activate navigation when no navigation config is provided", async () => {
        const onNavigationReady = vi.fn();

        await startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/", "home");
            },
            mount() {
                return vi.fn();
            },
            callbacks: makeCallbacks(),
            onNavigationReady,
        });

        // 无 navigation 定义 → 不触发 onNavigationReady，走原有单页路径。
        expect(onNavigationReady).not.toHaveBeenCalled();
    });

    test("does not activate session when no session config is provided", async () => {
        const onSessionReady = vi.fn();

        await startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/", "home");
            },
            mount() {
                return vi.fn();
            },
            callbacks: makeCallbacks(),
            onSessionReady,
        });

        // 无 session 定义 → 不触发 onSessionReady，启动路径字节级不变。
        expect(onSessionReady).not.toHaveBeenCalled();
    });

    test("restores a pre-seeded sessionStorage snapshot through a flat provider on boot", async () => {
        // 在根 URL (`/`) 上 boot：defaultShouldRestore 对扁平快照放行（atRoot 或同 URL）。
        const sessionStorage = fakeWebStorage();
        sessionStorage.setItem(
            "__finesoft_session__",
            JSON.stringify({
                version: 1,
                navigation: { url: "/" },
                slices: { draft: "half-typed" },
                scoped: {},
                capturedAt: 1,
            }),
        );
        vi.stubGlobal("window", {
            location: { pathname: "/", search: "", origin: "https://example.com" },
            sessionStorage,
            localStorage: fakeWebStorage(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });

        const restored: unknown[] = [];

        await startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/", "home");
            },
            mount() {
                return vi.fn();
            },
            callbacks: makeCallbacks(),
            session: {
                providers: [
                    {
                        key: "draft",
                        capture: () => "",
                        restore: (data) => {
                            restored.push(data);
                        },
                    },
                ],
            },
        });

        // boot 恢复：持久化的 draft 切片派回 provider。
        expect(restored).toEqual(["half-typed"]);
    });

    test("hands a session handle to onSessionReady", async () => {
        vi.stubGlobal("window", {
            location: { pathname: "/", search: "", origin: "https://example.com" },
            sessionStorage: fakeWebStorage(),
            localStorage: fakeWebStorage(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });

        let handle: import("../src/session-bridge").SessionHandle | undefined;

        await startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/", "home");
            },
            mount() {
                return vi.fn();
            },
            callbacks: makeCallbacks(),
            session: {},
            onSessionReady(received) {
                handle = received;
            },
        });

        expect(handle).toBeDefined();
        expect(typeof handle?.save).toBe("function");
        expect(typeof handle?.clear).toBe("function");
        expect(typeof handle?.restore).toBe("function");
        expect(typeof handle?.dispose).toBe("function");
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

/** 最小内存 Web Storage 伪实现，覆盖 createWebStorage 实际触达的成员。 */
function fakeWebStorage(): Storage {
    const m = new Map<string, string>();
    return {
        getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
        setItem: (k, v) => void m.set(k, String(v)),
        removeItem: (k) => void m.delete(k),
        clear: () => {
            m.clear();
        },
        key: (i) => Array.from(m.keys())[i] ?? null,
        get length() {
            return m.size;
        },
    } as Storage;
}
