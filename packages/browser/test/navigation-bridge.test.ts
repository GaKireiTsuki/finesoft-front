import type { Logger } from "@finesoft/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

/**
 * History mock —— 同 flow-action.test：用 hoisted class 顶替真实 History，
 * 记录 push/replace/onPopState 并保留 popListener 供测试手动触发。
 */
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

vi.mock("../src/utils/history", () => ({
    History: HistoryMock,
}));

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import {
    createActiveLeafCodec,
    createFullStateCodec,
    createNavigationController,
    deserializeNavigation,
    leaf,
    serializeNavigation,
    stack,
    tabs,
    type BasePage,
    type Intent,
    type NavigationController,
    type NavigationNode,
    type NavigationRouterLike,
    type RouteParams,
    type SerializedNavigation,
} from "../../core/src/index.ts";
import { createNavigationBridge } from "../src/navigation-bridge";

interface NavigationHistoryState {
    tree: SerializedNavigation;
}

afterEach(() => {
    HistoryMock.reset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

beforeEach(() => {
    vi.stubGlobal("window", {
        location: {
            pathname: "/home",
            search: "",
            origin: "https://app.example",
            href: "https://app.example/home",
        },
        addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
        cookie: "",
        documentElement: { scrollTop: 0 },
        getElementById: vi.fn(() => null),
    });
});

describe("createNavigationBridge", () => {
    test("replaces history for the first snapshot and pushes for subsequent ones", async () => {
        const initial = stack([leaf("home")]);
        const { controller } = makeController(initial);
        const codec = createActiveLeafCodec();
        const router = makeRouter(["/home → home", "/products/:id → product"]);
        const log = makeLogger();

        createNavigationBridge({ controller, codec, router, log });

        // 首屏快照 → replaceState（first-page），URL 反查为激活叶子 /home。
        await controller.resolve();
        const history = HistoryMock.latest<NavigationHistoryState>();
        expect(history.replaceState).toHaveBeenCalledTimes(1);
        expect(history.replaceState.mock.calls[0][1]).toBe("/home");
        expect(history.replaceState.mock.calls[0][0]).toEqual({
            tree: serializeNavigation(initial),
        });
        expect(history.pushState).not.toHaveBeenCalled();

        // 后续导航（URL 变化）→ pushState。
        await controller.push("product", { id: "42" });
        expect(history.pushState).toHaveBeenCalledTimes(1);
        expect(history.pushState.mock.calls[0][1]).toBe("/products/42");
        const pushedTree = (history.pushState.mock.calls[0][0] as NavigationHistoryState).tree;
        // 推入的是新树（含 product 栈顶），可无损还原。
        const restored = deserializeNavigation(pushedTree);
        expect(restored.kind).toBe("stack");
    });

    test("replaces (not pushes) when the encoded URL equals the current location", async () => {
        const { controller } = makeController(stack([leaf("home")]));
        const codec = createActiveLeafCodec();
        const router = makeRouter(["/home → home", "/about → about"]);
        const log = makeLogger();

        createNavigationBridge({ controller, codec, router, log });
        await controller.resolve(); // first → replace /home
        const history = HistoryMock.latest<NavigationHistoryState>();

        // window.location 当前是 /home；replaceTop 到 about 后 encode=/about ≠ /home → push。
        await controller.replaceTop("about");
        expect(history.pushState).toHaveBeenCalledTimes(1);
        expect(history.pushState.mock.calls[0][1]).toBe("/about");

        // 再 replaceTop 回 home：encode=/home == window.location /home → replaceState（不新增条目）。
        history.replaceState.mockClear();
        await controller.replaceTop("home");
        expect(history.replaceState).toHaveBeenCalledTimes(1);
        expect(history.replaceState.mock.calls[0][1]).toBe("/home");
    });

    test("popstate restores the tree from cached history state and hydrates", async () => {
        const { controller, dispatch } = makeController(leaf("home"));
        const codec = createActiveLeafCodec();
        const router = makeRouter(["/home → home", "/settings → settings"]);
        const log = makeLogger();

        createNavigationBridge({ controller, codec, router, log });
        await controller.resolve();
        const history = HistoryMock.latest<NavigationHistoryState>();
        dispatch.mockClear();

        // 模拟 back 到一棵缓存树（settings 栈顶）。
        const cachedTree = stack([leaf("home"), leaf("settings")]);
        await history.popListener?.("https://app.example/settings", {
            tree: serializeNavigation(cachedTree),
        });

        // 控制器已 hydrate 到缓存树。
        expect(controller.getTree()).toEqual(cachedTree);
        // 关键不变量：popstate 触发的 hydrate 不回写 history。
        expect(history.pushState).not.toHaveBeenCalled();
        // settings 是新可见目标，被 dispatch。
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ id: "settings" }),
            expect.anything(),
        );
    });

    test("popstate falls back to codec.decode when no cached state is present", async () => {
        const { controller } = makeController(leaf("home"));
        // full-state codec 能从 __nav 参数同步还原整棵树。
        const codec = createFullStateCodec();
        const router = makeRouter(["/home → home", "/dashboard → dashboard"]);
        const log = makeLogger();

        createNavigationBridge({ controller, codec, router, log });
        await controller.resolve();
        const history = HistoryMock.latest<NavigationHistoryState>();

        const deepTree = tabs({
            active: "main",
            branches: { main: leaf("dashboard"), side: leaf("home") },
        });
        const deepUrl = codec.encode(deepTree, router);

        await history.popListener?.(`https://app.example${deepUrl}`, undefined);

        expect(controller.getTree()).toEqual(deepTree);
        expect(history.pushState).not.toHaveBeenCalled();
    });

    test("popstate keeps the current tree when nothing can be restored", async () => {
        const { controller } = makeController(leaf("home"));
        // active-leaf codec 对无 __nav 覆盖的 URL 返回 undefined（不可同步还原）。
        const codec = createActiveLeafCodec();
        const router = makeRouter(["/home → home"]);
        const log = makeLogger();

        createNavigationBridge({ controller, codec, router, log });
        await controller.resolve();
        const before = controller.getTree();
        const history = HistoryMock.latest<NavigationHistoryState>();

        await history.popListener?.("https://app.example/unknown", undefined);

        // 树保持不变；记 warn。
        expect(controller.getTree()).toBe(before);
        expect(log.warn).toHaveBeenCalledWith(
            "[navigation] popstate: cannot restore tree for https://app.example/unknown, keeping current",
        );
    });

    test("popstate falls back to codec.decode when the cached tree is corrupt", async () => {
        const { controller } = makeController(leaf("home"));
        const codec = createFullStateCodec();
        const router = makeRouter(["/home → home", "/reports → reports"]);
        const log = makeLogger();

        createNavigationBridge({ controller, codec, router, log });
        await controller.resolve();
        const history = HistoryMock.latest<NavigationHistoryState>();

        const fallbackTree = leaf("reports");
        const url = codec.encode(fallbackTree, router);

        // 缓存的 state.tree 结构损坏 → deserialize 抛错 → 回退 codec.decode(url)。
        await history.popListener?.(`https://app.example${url}`, {
            tree: { kind: "nonsense" } as unknown as SerializedNavigation,
        });

        expect(controller.getTree()).toEqual(fallbackTree);
        expect(log.warn).toHaveBeenCalledWith(
            "[navigation] cached tree deserialize failed, falling back to codec",
            expect.anything(),
        );
    });

    test("popstate logs and keeps current tree when codec.decode throws", async () => {
        const { controller } = makeController(leaf("home"));
        const throwingCodec = {
            encode: () => "/home",
            decode: () => {
                throw new Error("decode boom");
            },
        };
        const router = makeRouter(["/home → home"]);
        const log = makeLogger();

        createNavigationBridge({ controller, codec: throwingCodec, router, log });
        await controller.resolve();
        const before = controller.getTree();
        const history = HistoryMock.latest<NavigationHistoryState>();

        await history.popListener?.("https://app.example/x", undefined);

        expect(controller.getTree()).toBe(before);
        expect(log.error).toHaveBeenCalledWith(
            "[navigation] codec.decode failed:",
            expect.any(Error),
        );
    });

    test("exposes a handle that delegates every operation to the controller", async () => {
        const controller = makeFakeController();
        const codec = createActiveLeafCodec();
        const router = makeRouter(["/home → home"]);
        const log = makeLogger();

        const handle = createNavigationBridge({
            controller: controller as unknown as NavigationController,
            codec,
            router,
            log,
        });

        const snap = handle.getSnapshot();
        expect(snap).toBe(controller.getSnapshot());

        await handle.push("a", { x: 1 }, { target: [] });
        await handle.pop(2);
        await handle.popToRoot();
        await handle.replaceTop("b");
        await handle.selectTab("k", []);
        await handle.selectColumn("c", "intent", { y: 2 }, []);
        await handle.hydrate(leaf("z"));
        const listener = vi.fn();
        const unsub = handle.subscribe(listener);

        expect(controller.push).toHaveBeenCalledWith("a", { x: 1 }, { target: [] });
        expect(controller.pop).toHaveBeenCalledWith(2);
        expect(controller.popToRoot).toHaveBeenCalledTimes(1);
        expect(controller.replaceTop).toHaveBeenCalledWith("b", undefined);
        expect(controller.selectTab).toHaveBeenCalledWith("k", []);
        expect(controller.selectColumn).toHaveBeenCalledWith("c", "intent", { y: 2 }, []);
        expect(controller.hydrate).toHaveBeenCalledWith(leaf("z"));
        expect(controller.subscribe).toHaveBeenCalledWith(listener);
        expect(typeof unsub).toBe("function");
    });

    test("registers a popstate listener on construction", () => {
        const controller = makeFakeController();
        const codec = createActiveLeafCodec();
        const router = makeRouter([]);
        const log = makeLogger();

        createNavigationBridge({
            controller: controller as unknown as NavigationController,
            codec,
            router,
            log,
        });

        expect(HistoryMock.latest().onPopState).toHaveBeenCalledTimes(1);
    });
});

// =====================================================================
// 测试辅助
// =====================================================================

/** 用真实 controller + codec 做集成；intentDispatcher/router 用最小 fake。 */
function makeController(initial: NavigationNode): {
    controller: NavigationController;
    dispatch: ReturnType<typeof vi.fn>;
} {
    const dispatch = vi.fn(async (intent: Intent<BasePage>) => makePage(intent.id));
    const intentDispatcher = { dispatch } as never;
    const router = {
        resolve: vi.fn(async (url: string) => {
            const path = new URL(url, "https://app.example").pathname;
            const id = path.replace(/^\//, "") || "home";
            return { intent: { id, params: {} } };
        }),
        getRoutes: () => [],
    } as never;

    const controller = createNavigationController({
        intentDispatcher,
        router,
        initial,
        createContext: ({ intent, params }) => ({
            container: {} as never,
            url: "/",
            navigation: makeNavContext(intent, params),
        }),
    });

    return { controller, dispatch };
}

/**
 * 纯 fake controller：每个方法都是 vi.fn，用于验证 handle 委派。
 *
 * 刻意返回**对象字面量类型**（不标注成 `NavigationController` 接口），这样在 `expect(fake.push)`
 * 上是普通属性访问而非接口方法引用，避开 `unbound-method` 警告（同 flow-action.test 的
 * `framework.didEnterPage` 写法）。传入 bridge 时在调用点 `as` 成 controller。
 */
function makeFakeController() {
    const snapshot = { tree: leaf("home"), destinations: [] };
    return {
        getTree: vi.fn(() => leaf("home")),
        getSnapshot: vi.fn(() => snapshot),
        apply: vi.fn(async () => snapshot),
        push: vi.fn(async () => snapshot),
        pop: vi.fn(async () => snapshot),
        popToRoot: vi.fn(async () => snapshot),
        replaceTop: vi.fn(async () => snapshot),
        selectTab: vi.fn(async () => snapshot),
        selectColumn: vi.fn(async () => snapshot),
        hydrate: vi.fn(async () => snapshot),
        subscribe: vi.fn(() => () => undefined),
        resolve: vi.fn(async () => snapshot),
    };
}

function makeNavContext(intent: string, params: RouteParams) {
    return {
        url: "/",
        path: "/",
        params,
        intent: { id: intent, params },
        isServer: false,
        container: {} as never,
        getCookie: () => undefined,
        getHeader: () => undefined,
    };
}

function makeRouter(routes: string[]): NavigationRouterLike {
    return { getRoutes: () => routes };
}

function makePage(id: string): BasePage {
    return { id, pageType: "test", title: id };
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
