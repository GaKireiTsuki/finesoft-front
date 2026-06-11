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
import { FakeCustomEvent, FakeElement, FakeEvent, makeFakeDocumentWithRoot } from "./fake-dom";

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

    test("mount context 收到就绪的 navigation handle（snapshot.tree 为 initial 树）", async () => {
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

        let ctx:
            | {
                  navigation?: import("../src/navigation-bridge").NavigationHandle;
                  app?: import("../src/app-handle").AppHandle;
              }
            | undefined;

        await startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/home", "home");
                framework.registerIntent(new HomeController());
            },
            mount(_t, context) {
                ctx = context;
                return vi.fn();
            },
            callbacks: makeCallbacks(),
            navigation: {
                initial: stack([leaf("home")]),
            },
        });

        expect(ctx?.navigation).toBeDefined();
        // mount 时 tree 已就绪（nav-core 在 mount 前完成，controller.resolve() 在 mount 后）
        // getSnapshot().tree 返回 initial 树；destinations 在 resolve() 后才填充（mount 后）。
        expect(ctx?.navigation?.getSnapshot().tree).toEqual(stack([leaf("home")]));
        expect(typeof ctx?.app?.push).toBe("function"); // 统一句柄到位

        // bridge 已用 replaceState 写入首屏树（first-page，不污染历史栈）—— resolve() 后触发。
        const historyApi = window.history as unknown as { replaceState: ReturnType<typeof vi.fn> };
        expect(historyApi.replaceState).toHaveBeenCalled();
        expect(historyApi.replaceState.mock.calls.at(-1)?.[2]).toBe("/home");
        // popstate listener 已注册（bridge 装配）。
        expect(popListeners.has("popstate")).toBe(true);
    });

    test("无 navigation/session 配置 → mount context 不含 navigation/session/app", async () => {
        let ctx: Record<string, unknown> | undefined;

        await startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/", "home");
            },
            mount(_t, context) {
                ctx = context as Record<string, unknown>;
                return vi.fn();
            },
            callbacks: makeCallbacks(),
        });

        // 无 navigation/session 定义 → context 仅含 framework，走原有单页路径。
        expect(ctx?.navigation).toBeUndefined();
        expect(ctx?.session).toBeUndefined();
        expect(ctx?.app).toBeUndefined();
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

    test("session handle 经 mount context 交付，且 restore 在 mount 之后", async () => {
        const order: string[] = [];

        // 预置快照：restore 会把 slices.draft 派回 provider。
        // 当前 URL 是 "/"，defaultShouldRestore 在 atRoot 时放行。
        const storage = makeCoreStorage();
        storage.set(
            "__finesoft_session__",
            JSON.stringify({
                version: 1,
                navigation: { url: "/" },
                slices: { draft: "saved-value" },
                scoped: {},
                capturedAt: Date.now(),
            }),
        );

        vi.stubGlobal("window", {
            location: { pathname: "/", search: "", origin: "https://example.com" },
            sessionStorage: fakeWebStorage(),
            localStorage: fakeWebStorage(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });

        let ctxSession: import("../src/session-bridge").SessionHandle | undefined;

        await startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/", "home");
            },
            mount(_t, context) {
                order.push("mount");
                ctxSession = context.session;
                return vi.fn();
            },
            callbacks: makeCallbacks(),
            session: {
                storage,
                providers: [
                    {
                        key: "draft",
                        capture: () => "",
                        restore: () => {
                            order.push("restore");
                        },
                    },
                ],
            },
        });

        // handle 在 mount 时就绪（session-core 在 mount 前完成）。
        expect(typeof ctxSession?.save).toBe("function");
        expect(typeof ctxSession?.clear).toBe("function");
        expect(typeof ctxSession?.restore).toBe("function");
        expect(typeof ctxSession?.dispose).toBe("function");
        // restore 在 mount 之后（保 SSR 水合 parity）。
        expect(order).toEqual(["mount", "restore"]);
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

// ---------------------------------------------------------------------------
// Islands integration — navigation.mountEntry opt-in
// ---------------------------------------------------------------------------

describe("startBrowserApp — islands（navigation.mountEntry）", () => {
    beforeEach(() => {
        registerActionHandlers.mockReset();
        vi.spyOn(console, "warn").mockImplementation(() => {});

        // Islands path needs window.history + window.addEventListener (for NavigationBridge)
        // and CustomEvent (for island lifecycle events).
        vi.stubGlobal("CustomEvent", FakeCustomEvent);
        vi.stubGlobal("window", {
            location: {
                pathname: "/",
                search: "",
                origin: "https://example.com",
                href: "https://example.com/",
            },
            history: {
                state: null as { id?: string } | null,
                replaceState: vi.fn(),
                pushState: vi.fn(),
            },
            addEventListener: vi.fn(),
        });
    });

    afterEach(() => {
        globalThis.__FINESOFT_I18N_LOADER__ = undefined;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    test("提供 mountEntry：首屏可见目标挂为 outlet 内的 island", async () => {
        const { leaf, stack, BaseController, sessionEntryKey } =
            await import("../../core/src/index.ts");

        // Build a FakeElement tree:  #app → <header data-chrome> + <main data-fs-outlet>
        // We do this in the mount callback (DOM API, no innerHTML parser).
        const appRoot = new FakeElement("div");
        appRoot.setAttribute("id", "app");

        // Stub document: createElement returns FakeElement, getElementById("app") → appRoot.
        vi.stubGlobal("document", {
            ...makeFakeDocumentWithRoot("app", appRoot),
        });

        class HomeController extends BaseController<
            Record<string, never>,
            { id: string; title?: string }
        > {
            readonly intentId = "home";
            execute(): { id: string; title?: string } {
                return { id: "home", pageType: "home", title: "Home" } as never;
            }
        }

        const mountCalls: string[] = [];

        await startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/", "home");
                framework.registerIntent(new HomeController());
            },
            mount(target) {
                // Build chrome + outlet via DOM API (FakeElement has no innerHTML parser).
                const chrome = document.createElement("header") as unknown as FakeElement;
                chrome.setAttribute("data-chrome", "");
                const outlet = document.createElement("main") as unknown as FakeElement;
                outlet.setAttribute("data-fs-outlet", "");
                (target as unknown as FakeElement).appendChild(chrome);
                (target as unknown as FakeElement).appendChild(outlet);
                return () => undefined;
            },
            callbacks: makeCallbacks(),
            navigation: {
                initial: stack([leaf("home")]),
                mountEntry(entry, container) {
                    mountCalls.push(entry.entryKey);
                    container.textContent =
                        (entry.page as unknown as { title?: string }).title ?? "";
                    return { unmount() {} };
                },
            },
        });

        // The outlet is the <main data-fs-outlet> child of appRoot.
        const outlet = appRoot.querySelector("[data-fs-outlet]");
        expect(outlet).not.toBeNull();
        expect(mountCalls).toEqual([sessionEntryKey("home", {})]);
        // Island container should be in the outlet.
        const island = outlet?.querySelector("[data-fs-entry]");
        expect(island).not.toBeNull();
        expect(island?.textContent).toBe("Home");
    });

    test("不提供 mountEntry：走原有路径，outlet 内无 island", async () => {
        const { leaf, stack, BaseController } = await import("../../core/src/index.ts");

        const appRoot = new FakeElement("div");

        vi.stubGlobal("document", {
            ...makeFakeDocumentWithRoot("app", appRoot),
        });

        class HomeController extends BaseController<Record<string, never>, { id: string }> {
            readonly intentId = "home";
            execute(): { id: string } {
                return { id: "home" };
            }
        }

        const updateCalls: number[] = [];

        await startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/", "home");
                framework.registerIntent(new HomeController());
            },
            mount() {
                // No outlet built — mountEntry absent so orchestrator never runs.
                return () => {
                    updateCalls.push(1);
                };
            },
            callbacks: makeCallbacks(),
            navigation: {
                initial: stack([leaf("home")]),
                // No mountEntry → islands path inactive.
            },
        });

        // appRoot has no [data-fs-outlet] child → orchestrator code path was not reached.
        expect(appRoot.querySelector("[data-fs-outlet]")).toBeNull();
        expect(appRoot.querySelector("[data-fs-entry]")).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// domRestore integration — opt-in (islands + session)
// ---------------------------------------------------------------------------

describe("startBrowserApp — domRestore（islands + session）", () => {
    beforeEach(() => {
        registerActionHandlers.mockReset();
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.stubGlobal("CustomEvent", FakeCustomEvent);
        vi.stubGlobal("Event", FakeEvent);
        // No requestAnimationFrame → sync fallback in createDomRestore engages.
        vi.stubGlobal("requestAnimationFrame", undefined);
        vi.stubGlobal("window", {
            location: {
                pathname: "/",
                search: "",
                origin: "https://example.com",
                href: "https://example.com/",
            },
            history: { state: null, replaceState: vi.fn(), pushState: vi.fn() },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
    });

    afterEach(() => {
        globalThis.__FINESOFT_I18N_LOADER__ = undefined;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    test("opt-in domRestore：boot 时从会话 scope 回填 island 表单值", async () => {
        const { leaf, stack, BaseController, sessionEntryKey, SESSION_DEFAULT_VERSION } =
            await import("../../core/src/index.ts");

        // Build seeded core Storage with a SessionSnapshot containing __dom state.
        const entryKey = sessionEntryKey("home", {});
        const snapshot = {
            version: SESSION_DEFAULT_VERSION,
            // Structured navigation with kind:"leaf" → defaultShouldRestore passes at root "/".
            navigation: { kind: "leaf", intent: "home", params: {} },
            slices: {},
            scoped: { [entryKey]: { __dom: { fields: { note: "restored" } } } },
            capturedAt: Date.now(),
        };
        const storage = makeCoreStorage();
        storage.set("__finesoft_session__", JSON.stringify(snapshot));

        // Build FakeElement tree: #app → chrome + <main data-fs-outlet>.
        const appRoot = new FakeElement("div");
        appRoot.setAttribute("id", "app");

        vi.stubGlobal("document", {
            ...makeFakeDocumentWithRoot("app", appRoot),
            visibilityState: "visible",
        });

        class HomeController extends BaseController<Record<string, never>, { id: string }> {
            readonly intentId = "home";
            execute(): { id: string } {
                return { id: "home", pageType: "home", title: "Home" } as never;
            }
        }

        await startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/", "home");
                framework.registerIntent(new HomeController());
            },
            mount(target) {
                const chrome = document.createElement("header") as unknown as FakeElement;
                chrome.setAttribute("data-chrome", "");
                const outlet = document.createElement("main") as unknown as FakeElement;
                outlet.setAttribute("data-fs-outlet", "");
                (target as unknown as FakeElement).appendChild(chrome);
                (target as unknown as FakeElement).appendChild(outlet);
                return () => undefined;
            },
            callbacks: makeCallbacks(),
            navigation: {
                initial: stack([leaf("home")]),
                mountEntry(entry, container) {
                    // Build <div data-restore-root><input name="note"></div> via DOM API.
                    const root = document.createElement("div") as unknown as FakeElement;
                    root.setAttribute("data-restore-root", "");
                    const input = document.createElement("input") as unknown as FakeElement;
                    input.setAttribute("name", "note");
                    root.appendChild(input);
                    (container as unknown as FakeElement).appendChild(root);
                    return { unmount() {} };
                },
            },
            session: { storage },
            domRestore: true,
        });

        // schedule defaults to sync (rAF undefined) → catch-up restores synchronously inside attach.
        const outlet = appRoot.querySelector("[data-fs-outlet]");
        const input = outlet?.querySelector('[name="note"]') as FakeElement | null;
        expect(input?.value).toBe("restored");
    });

    test("domRestore:false（缺省）：不恢复，既有路径不受影响", async () => {
        const { leaf, stack, BaseController, sessionEntryKey, SESSION_DEFAULT_VERSION } =
            await import("../../core/src/index.ts");

        const entryKey = sessionEntryKey("home", {});
        const snapshot = {
            version: SESSION_DEFAULT_VERSION,
            navigation: { kind: "leaf", intent: "home", params: {} },
            slices: {},
            scoped: { [entryKey]: { __dom: { fields: { note: "should-not-restore" } } } },
            capturedAt: Date.now(),
        };
        const storage = makeCoreStorage();
        storage.set("__finesoft_session__", JSON.stringify(snapshot));

        const appRoot = new FakeElement("div");
        appRoot.setAttribute("id", "app");

        vi.stubGlobal("document", {
            ...makeFakeDocumentWithRoot("app", appRoot),
            visibilityState: "visible",
        });

        class HomeController extends BaseController<Record<string, never>, { id: string }> {
            readonly intentId = "home";
            execute(): { id: string } {
                return { id: "home" } as never;
            }
        }

        await startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/", "home");
                framework.registerIntent(new HomeController());
            },
            mount(target) {
                const outlet = document.createElement("main") as unknown as FakeElement;
                outlet.setAttribute("data-fs-outlet", "");
                (target as unknown as FakeElement).appendChild(outlet);
                return () => undefined;
            },
            callbacks: makeCallbacks(),
            navigation: {
                initial: stack([leaf("home")]),
                mountEntry(_entry, container) {
                    const root = document.createElement("div") as unknown as FakeElement;
                    root.setAttribute("data-restore-root", "");
                    const input = document.createElement("input") as unknown as FakeElement;
                    input.setAttribute("name", "note");
                    root.appendChild(input);
                    (container as unknown as FakeElement).appendChild(root);
                    return { unmount() {} };
                },
            },
            session: { storage },
            // domRestore omitted → defaults to false, no restore.
        });

        const outlet = appRoot.querySelector("[data-fs-outlet]");
        const input = outlet?.querySelector('[name="note"]') as FakeElement | null;
        // Value stays at initial empty string — domRestore did not run.
        expect(input?.value).toBe("");
    });
});

// ---------------------------------------------------------------------------
// flat-islands + session — 隐式单栈也要给会话喂导航变更信号（item 1）
// ---------------------------------------------------------------------------

describe("startBrowserApp — flat-islands + session", () => {
    beforeEach(() => {
        registerActionHandlers.mockReset();
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.stubGlobal("CustomEvent", FakeCustomEvent);
        vi.stubGlobal("window", {
            location: {
                pathname: "/",
                search: "",
                origin: "https://example.com",
                href: "https://example.com/",
            },
            history: {
                state: null as { id?: string } | null,
                replaceState: vi.fn(),
                pushState: vi.fn(),
            },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
    });

    afterEach(() => {
        globalThis.__FINESOFT_I18N_LOADER__ = undefined;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    async function bootFlatIslandsSession(): Promise<{
        handle: import("../src/session-bridge").SessionHandle;
        storage: import("@finesoft/core").Storage;
        callbacks: ReturnType<typeof makeCallbacks>;
    }> {
        const { leaf, BaseController } = await import("../../core/src/index.ts");
        void leaf;
        const appRoot = new FakeElement("div");
        appRoot.setAttribute("id", "app");
        vi.stubGlobal("document", {
            ...makeFakeDocumentWithRoot("app", appRoot),
            visibilityState: "visible",
        });

        class HomeController extends BaseController<Record<string, never>, { id: string }> {
            readonly intentId = "home";
            execute(): { id: string } {
                return { id: "home" } as never;
            }
        }

        const storage = makeCoreStorage();
        const callbacks = makeCallbacks();
        let handle: import("../src/session-bridge").SessionHandle | undefined;

        await startBrowserApp({
            bootstrap(framework) {
                framework.router.add("/", "home");
                framework.registerIntent(new HomeController());
            },
            mount(target, context) {
                handle = context.session;
                const outlet = document.createElement("main") as unknown as FakeElement;
                outlet.setAttribute("data-fs-outlet", "");
                (target as unknown as FakeElement).appendChild(outlet);
                return () => undefined;
            },
            callbacks,
            // flat-islands：顶层 mountEntry、无 navigation。
            mountEntry(_entry, container) {
                (container as unknown as FakeElement).textContent = "home-island";
                return { unmount() {} };
            },
            session: { storage },
        });

        if (!handle) throw new Error("mount context 未收到 session handle");
        return { handle, storage, callbacks };
    }

    test("不为 flat-islands 创建 flatNavigation 发射器：callbacks 原样透传（不包装 onNavigate）", async () => {
        const { callbacks } = await bootFlatIslandsSession();
        // flat-islands 的正向导航 bypass callbacks.onNavigate，故 flatNavigation tee 是错误信号、不应创建。
        expect(registerActionHandlers).toHaveBeenCalledTimes(1);
        expect(registerActionHandlers.mock.calls[0][0].callbacks).toBe(callbacks);
    });

    test("会话快照包含当前 URL（flat-islands session 在 mount 前建，用 URL 适配器）", async () => {
        const { handle, storage } = await bootFlatIslandsSession();
        handle.save();
        const raw = storage.get("__finesoft_session__");
        expect(raw).toBeDefined();
        const snapshot = JSON.parse(raw as string) as {
            navigation?: { kind?: string; url?: string };
            url?: string;
        };
        // flat-islands + session：session-core 在 mount 前建，flat-islands controller 尚未存在，
        // 退 URL 适配器（capture 返回 { url } 而非 stack 树）。未用组合，接受此行为。
        expect(snapshot.navigation?.url).toBe("/");
        // capture 时刻的可比 URL 也应记录（供 defaultShouldRestore 精确匹配）。
        expect(snapshot.url).toBe("/");
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

/**
 * core `Storage` 替身（get/set/delete 接口），可在测试中预置序列化快照。
 * 区别于上面的 `fakeWebStorage`（浏览器 Web Storage 接口）：本函数实现 core 的
 * `Storage` 接口（`get`/`set`/`delete`），直接传给 `BrowserSessionConfig.storage`。
 */
function makeCoreStorage(): import("@finesoft/core").Storage {
    const m = new Map<string, string>();
    return {
        get: (k: string) => m.get(k),
        set: (k: string, v: string) => void m.set(k, v),
        delete: (k: string) => void m.delete(k),
    };
}
