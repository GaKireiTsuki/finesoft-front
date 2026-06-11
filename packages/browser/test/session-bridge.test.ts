import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import type {
    SessionNavigationAdapter,
    SessionSnapshot,
    SessionStore,
} from "../../core/src/index.ts";
import {
    createSessionBridge,
    defaultShouldRestore,
    SESSION_DEFAULT_DEBOUNCE_MS,
    type SessionHandle,
} from "../src/session-bridge";

// =====================================================================
// Fakes —— store / adapter / DOM EventTarget（仅本测试用）
// =====================================================================

/**
 * 极简 EventTarget fake：记录 add/removeEventListener，并能手动 dispatch。
 * jsdom 未作为全局 environment 装载（见 vite.config.ts），browser 测试统一用
 * stubGlobal + 手造对象（对齐 navigation-bridge.test 风格）。
 */
function makeEventTarget(): {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    dispatch(type: string): void;
    listenerCount(type: string): number;
} {
    const listeners = new Map<string, Set<() => void>>();
    return {
        addEventListener: vi.fn((type: string, handler: () => void) => {
            const set = listeners.get(type) ?? new Set<() => void>();
            set.add(handler);
            listeners.set(type, set);
        }),
        removeEventListener: vi.fn((type: string, handler: () => void) => {
            listeners.get(type)?.delete(handler);
        }),
        dispatch(type: string): void {
            for (const handler of listeners.get(type) ?? []) handler();
        },
        listenerCount(type: string): number {
            return listeners.get(type)?.size ?? 0;
        },
    };
}

/**
 * Fake SessionStore：scope 真实可 prune；save/load/restore/clear 用 spy。
 *
 * 刻意返回**对象字面量类型**（不标注成 `SessionStore` 接口），这样 `expect(store.save)`
 * 是普通属性访问而非接口方法引用，避开 `unbound-method` 警告（同 navigation-bridge.test
 * 对 fake controller 的写法）。传入 `createSessionBridge` 时在调用点 `as` 成接口。
 */
function makeStore(
    over: {
        load?: () => SessionSnapshot | undefined;
        restore?: (snapshot?: SessionSnapshot) => void | Promise<void>;
    } = {},
) {
    const scopeMap = new Map<string, unknown>();
    const scope = {
        get: (k: string) => scopeMap.get(k),
        set: (k: string, v: unknown) => void scopeMap.set(k, v),
        delete: (k: string) => void scopeMap.delete(k),
        prune: vi.fn((presentKeys: Iterable<string>) => {
            const keep = new Set(presentKeys);
            const drop: string[] = [];
            for (const k of scopeMap.keys()) if (!keep.has(k)) drop.push(k);
            for (const k of drop) scopeMap.delete(k);
        }),
        keys: () => [...scopeMap.keys()],
    };
    return {
        register: vi.fn(() => () => undefined),
        scope,
        capture: vi.fn(() => snap()),
        persist: vi.fn(),
        load: vi.fn(over.load ?? (() => undefined)),
        restore: vi.fn(over.restore ?? (() => undefined)),
        clear: vi.fn(),
        save: vi.fn(),
    };
}

/** Fake adapter：presentKeys 由测试控制（用于断言 prune 入参）。 */
function makeAdapter(present: () => Iterable<string>) {
    return {
        capture: () => undefined,
        apply: () => undefined,
        presentKeys: present,
    };
}

/**
 * 用 fake 构造 bridge：把对象字面量类型的 fake 收窄到 `createSessionBridge` 的接口入参
 * （fake 故意不标注接口类型，见 makeStore 注释）。所有用例经此唯一入口装配。
 */
function build(opts: {
    store: ReturnType<typeof makeStore>;
    adapter: ReturnType<typeof makeAdapter>;
    subscribeNavigation?: (onChange: () => void) => () => void;
    debounceMs?: number;
    shouldRestore?: (snapshot: SessionSnapshot, currentUrl: string) => boolean;
}): SessionHandle {
    return createSessionBridge({
        ...opts,
        store: opts.store as unknown as SessionStore,
        adapter: opts.adapter as SessionNavigationAdapter,
    });
}

function snap(over: Partial<SessionSnapshot> = {}): SessionSnapshot {
    return { version: 1, slices: {}, scoped: {}, capturedAt: 1000, ...over };
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

beforeEach(() => {
    vi.useFakeTimers();
});

// =====================================================================
// createSessionBridge —— 自动捕获（防抖 + 生命周期事件）
// =====================================================================

describe("createSessionBridge — auto-capture", () => {
    test("nav change debounces save (fires once after debounceMs)", () => {
        const win = makeEventTarget();
        const doc = makeEventTarget();
        vi.stubGlobal("window", win);
        vi.stubGlobal("document", doc);

        let onChange: (() => void) | undefined;
        const store = makeStore();
        const bridge = build({
            store,
            adapter: makeAdapter(() => []),
            subscribeNavigation: (cb) => {
                onChange = cb;
                return () => undefined;
            },
            debounceMs: 200,
        });

        onChange?.();
        onChange?.();
        onChange?.();
        expect(store.save).not.toHaveBeenCalled(); // 防抖窗口内未落盘

        vi.advanceTimersByTime(199);
        expect(store.save).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(store.save).toHaveBeenCalledTimes(1); // 三次合并为一次

        bridge.dispose();
    });

    test("uses SESSION_DEFAULT_DEBOUNCE_MS when debounceMs omitted", () => {
        vi.stubGlobal("window", makeEventTarget());
        vi.stubGlobal("document", makeEventTarget());

        let onChange: (() => void) | undefined;
        const store = makeStore();
        const bridge = build({
            store,
            adapter: makeAdapter(() => []),
            subscribeNavigation: (cb) => {
                onChange = cb;
                return () => undefined;
            },
        });

        onChange?.();
        vi.advanceTimersByTime(SESSION_DEFAULT_DEBOUNCE_MS - 1);
        expect(store.save).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(store.save).toHaveBeenCalledTimes(1);

        bridge.dispose();
    });

    test("nav change prunes scope to presentKeys (pop B drops B before save)", () => {
        vi.stubGlobal("window", makeEventTarget());
        vi.stubGlobal("document", makeEventTarget());

        let onChange: (() => void) | undefined;
        const store = makeStore();
        store.scope.set("A {}", { scroll: 10 });
        store.scope.set("B {}", { draft: "hi" });

        // pop B → present 仅剩 A。
        const bridge = build({
            store,
            adapter: makeAdapter(() => ["A {}"]),
            subscribeNavigation: (cb) => {
                onChange = cb;
                return () => undefined;
            },
            debounceMs: 100,
        });

        onChange?.();
        // prune 必须在防抖落盘之前同步发生。
        expect(store.scope.prune).toHaveBeenCalledWith(["A {}"]);
        expect(store.scope.get("A {}")).toEqual({ scroll: 10 });
        expect(store.scope.get("B {}")).toBeUndefined();

        bridge.dispose();
    });

    test("pagehide flushes immediately and cancels the pending debounce", () => {
        const win = makeEventTarget();
        vi.stubGlobal("window", win);
        vi.stubGlobal("document", makeEventTarget());

        let onChange: (() => void) | undefined;
        const store = makeStore();
        const bridge = build({
            store,
            adapter: makeAdapter(() => []),
            subscribeNavigation: (cb) => {
                onChange = cb;
                return () => undefined;
            },
            debounceMs: 500,
        });

        onChange?.(); // 排一个挂起的防抖落盘
        win.dispatch("pagehide"); // 立即落盘
        expect(store.save).toHaveBeenCalledTimes(1);

        // 防抖被取消：推进时间不再产生第二次落盘。
        vi.advanceTimersByTime(1000);
        expect(store.save).toHaveBeenCalledTimes(1);

        bridge.dispose();
    });

    test("visibilitychange flushes only when document is hidden", () => {
        const doc = makeEventTarget() as ReturnType<typeof makeEventTarget> & {
            visibilityState: string;
        };
        doc.visibilityState = "visible";
        vi.stubGlobal("window", makeEventTarget());
        vi.stubGlobal("document", doc);

        const store = makeStore();
        const bridge = build({
            store,
            adapter: makeAdapter(() => []),
        });

        doc.visibilityState = "visible";
        doc.dispatch("visibilitychange");
        expect(store.save).not.toHaveBeenCalled(); // 可见 → 不落盘

        doc.visibilityState = "hidden";
        doc.dispatch("visibilitychange");
        expect(store.save).toHaveBeenCalledTimes(1); // 隐藏 → 立即落盘

        bridge.dispose();
    });
});

// =====================================================================
// restore + shouldRestore 门控矩阵
// =====================================================================

describe("createSessionBridge — restore gate", () => {
    function bridgeWith(loaded: SessionSnapshot | undefined): {
        store: ReturnType<typeof makeStore>;
        bridge: SessionHandle;
    } {
        vi.stubGlobal("window", makeEventTarget());
        vi.stubGlobal("document", makeEventTarget());
        const store = makeStore({ load: () => loaded });
        const bridge = build({ store, adapter: makeAdapter(() => []) });
        return { store, bridge };
    }

    test("no persisted snapshot → restore not called", () => {
        const { store, bridge } = bridgeWith(undefined);
        void bridge.restore("/anything");
        expect(store.restore).not.toHaveBeenCalled();
        bridge.dispose();
    });

    test("flat snapshot: same url → restored", () => {
        const s = snap({ navigation: { url: "/posts/7" } });
        const { store, bridge } = bridgeWith(s);
        void bridge.restore("/posts/7");
        expect(store.restore).toHaveBeenCalledWith(s);
        bridge.dispose();
    });

    test("flat snapshot: different deep-link url → NOT restored", () => {
        const s = snap({ navigation: { url: "/posts/7" } });
        const { store, bridge } = bridgeWith(s);
        void bridge.restore("/posts/99");
        expect(store.restore).not.toHaveBeenCalled();
        bridge.dispose();
    });

    test("flat snapshot: at root / → restored", () => {
        const s = snap({ navigation: { url: "/posts/7" } });
        const { store, bridge } = bridgeWith(s);
        void bridge.restore("/?ref=x#frag");
        expect(store.restore).toHaveBeenCalledWith(s);
        bridge.dispose();
    });

    test("structured snapshot: at root / → restored", () => {
        const s = snap({
            navigation: { kind: "leaf", intent: "home", params: {} },
        });
        const { store, bridge } = bridgeWith(s);
        void bridge.restore("/");
        expect(store.restore).toHaveBeenCalledWith(s);
        bridge.dispose();
    });

    test("structured snapshot: at non-root /x → NOT restored", () => {
        const s = snap({
            navigation: { kind: "leaf", intent: "home", params: {} },
        });
        const { store, bridge } = bridgeWith(s);
        void bridge.restore("/x");
        expect(store.restore).not.toHaveBeenCalled();
        bridge.dispose();
    });

    test("structured snapshot with url: same deep link → restored", () => {
        const s = snap({
            navigation: { kind: "leaf", intent: "detail", params: { id: "1" } },
            url: "/item/1",
        });
        const { store, bridge } = bridgeWith(s);
        void bridge.restore("/item/1");
        expect(store.restore).toHaveBeenCalledWith(s);
        bridge.dispose();
    });

    test("structured snapshot with url: different deep link → NOT restored", () => {
        const s = snap({
            navigation: { kind: "leaf", intent: "detail", params: { id: "1" } },
            url: "/item/1",
        });
        const { store, bridge } = bridgeWith(s);
        void bridge.restore("/item/2");
        expect(store.restore).not.toHaveBeenCalled();
        bridge.dispose();
    });

    test("slices-only snapshot (no navigation) → restored regardless of url", () => {
        const s = snap({ slices: { theme: "dark" } });
        const { store, bridge } = bridgeWith(s);
        void bridge.restore("/deep/link");
        expect(store.restore).toHaveBeenCalledWith(s);
        bridge.dispose();
    });

    test("custom shouldRestore overrides the default policy", () => {
        const s = snap({ navigation: { url: "/posts/7" } });
        vi.stubGlobal("window", makeEventTarget());
        vi.stubGlobal("document", makeEventTarget());
        const store = makeStore({ load: () => s });
        const bridge = build({
            store,
            adapter: makeAdapter(() => []),
            shouldRestore: () => true, // 始终恢复，即便深链不匹配
        });
        void bridge.restore("/posts/99");
        expect(store.restore).toHaveBeenCalledWith(s);
        bridge.dispose();
    });

    test("restore forwards the async restore Promise", async () => {
        const s = snap({ slices: { theme: "dark" } });
        vi.stubGlobal("window", makeEventTarget());
        vi.stubGlobal("document", makeEventTarget());
        let resolved = false;
        const store = makeStore({
            load: () => s,
            restore: async () => {
                resolved = true;
            },
        });
        const bridge = build({ store, adapter: makeAdapter(() => []) });
        await bridge.restore("/");
        expect(resolved).toBe(true);
        bridge.dispose();
    });
});

// =====================================================================
// 手动逃生口 + dispose
// =====================================================================

describe("createSessionBridge — handle + dispose", () => {
    test("save/clear delegate to the store", () => {
        vi.stubGlobal("window", makeEventTarget());
        vi.stubGlobal("document", makeEventTarget());
        const store = makeStore();
        const bridge = build({ store, adapter: makeAdapter(() => []) });

        bridge.save();
        expect(store.save).toHaveBeenCalledTimes(1);
        bridge.clear();
        expect(store.clear).toHaveBeenCalledTimes(1);

        bridge.dispose();
    });

    test("dispose removes listeners, unsubscribes nav, and clears the timer", () => {
        const win = makeEventTarget();
        const doc = makeEventTarget();
        vi.stubGlobal("window", win);
        vi.stubGlobal("document", doc);

        let onChange: (() => void) | undefined;
        const unsub = vi.fn();
        const store = makeStore();
        const bridge = build({
            store,
            adapter: makeAdapter(() => []),
            subscribeNavigation: (cb) => {
                onChange = cb;
                return unsub;
            },
            debounceMs: 100,
        });

        // 装配后监听器已就位。
        expect(win.listenerCount("pagehide")).toBe(1);
        expect(doc.listenerCount("visibilitychange")).toBe(1);

        onChange?.(); // 排一个挂起的防抖
        bridge.dispose();

        // 取消订阅 + 解绑全部监听 + 清挂起定时器。
        expect(unsub).toHaveBeenCalledTimes(1);
        expect(win.listenerCount("pagehide")).toBe(0);
        expect(doc.listenerCount("visibilitychange")).toBe(0);

        vi.advanceTimersByTime(1000);
        expect(store.save).not.toHaveBeenCalled(); // 挂起的防抖已清

        // dispose 后再 dispatch 事件无副作用。
        win.dispatch("pagehide");
        doc.dispatch("visibilitychange");
        expect(store.save).not.toHaveBeenCalled();
    });
});

// =====================================================================
// defaultShouldRestore（直接单测策略边界）
// =====================================================================

describe("defaultShouldRestore", () => {
    test("flat: same url true, different false, root true", () => {
        const s = snap({ navigation: { url: "/a/b" } });
        expect(defaultShouldRestore(s, "/a/b")).toBe(true); // 全等命中（重载同 URL）
        expect(defaultShouldRestore(s, "/a/c")).toBe(false); // 不同深链 → 跳过
        expect(defaultShouldRestore(s, "/")).toBe(true); // 根入口 → 恢复
        expect(defaultShouldRestore(s, "/?q=1#h")).toBe(true); // 根判定剥离 query/hash
    });

    test("structured (no url): root true, non-root false（旧快照回退策略）", () => {
        const s = snap({ navigation: { kind: "leaf", intent: "home", params: {} } });
        expect(defaultShouldRestore(s, "/")).toBe(true);
        expect(defaultShouldRestore(s, "/x")).toBe(false);
    });

    test("structured with comparable url: same true, different false, root true（与扁平对称）", () => {
        const s = snap({
            navigation: { kind: "leaf", intent: "detail", params: { id: "1" } },
            url: "/item/1",
        });
        expect(defaultShouldRestore(s, "/item/1")).toBe(true); // 重载同深链 → 恢复
        expect(defaultShouldRestore(s, "/item/2")).toBe(false); // 改去别的深链 → 跳过
        expect(defaultShouldRestore(s, "/")).toBe(true); // 根入口 → 恢复
        expect(defaultShouldRestore(s, "/?q=1#h")).toBe(true); // 根判定剥离 query/hash
    });

    test("snapshot.url 优先于 nav.url（带 url 字段时以它为准）", () => {
        // url 与 nav.url 不一致时，门控以 snapshot.url 为准（它是 capture 时刻的真实位置）。
        const s = snap({ navigation: { url: "/stale" }, url: "/item/9" });
        expect(defaultShouldRestore(s, "/item/9")).toBe(true);
        expect(defaultShouldRestore(s, "/stale")).toBe(false);
    });

    test("no navigation: always true", () => {
        const s = snap({ slices: { a: 1 } });
        expect(defaultShouldRestore(s, "/anything/deep")).toBe(true);
    });
});

// =====================================================================
// createSessionBridge —— scope 暴露（导航作用域读写）
// =====================================================================

describe("createSessionBridge — scope handle", () => {
    test("handle.scope 委托 store.scope（读写互通）", () => {
        vi.stubGlobal("window", makeEventTarget());
        vi.stubGlobal("document", makeEventTarget());
        const store = makeStore();
        const bridge = build({ store, adapter: makeAdapter(() => []) });

        bridge.scope.set("home {}", { q: "hi" });
        expect(store.scope.get("home {}")).toEqual({ q: "hi" });
        expect(bridge.scope.get("home {}")).toEqual({ q: "hi" });
        bridge.dispose();
    });

    test("handle.scope 始终取最新 store.scope 实例（restore 重建后不失效）", () => {
        vi.stubGlobal("window", makeEventTarget());
        vi.stubGlobal("document", makeEventTarget());
        const store = makeStore();
        const bridge = build({ store, adapter: makeAdapter(() => []) });
        // 模拟 restore 重建 scope：替换 store.scope 为新实例
        const fresh = {
            get: () => "restored",
            set: () => {},
            delete: () => {},
            prune: () => {},
            keys: () => [],
        };
        (store as { scope: unknown }).scope = fresh;
        expect(bridge.scope.get("anything")).toBe("restored");
        bridge.dispose();
    });
});
