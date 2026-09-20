vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import type { SessionNavigation, SessionSnapshot, SessionStore } from "@finesoft/web";
import {
    createSessionBridge,
    defaultShouldRestore,
    SESSION_DEFAULT_DEBOUNCE_MS,
    type BrowserSession,
} from "../src/session-bridge";

// =====================================================================
// Fakes —— store / navigation / DOM EventTarget（仅本测试用）
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
        load: vi.fn(async () => {
            const snapshot = over.load?.();
            return snapshot ? { status: "loaded", snapshot } : { status: "missing" };
        }),
        restore: vi.fn(async (snapshot?: SessionSnapshot) => {
            await over.restore?.(snapshot);
            return { status: "restored" };
        }),
        clear: vi.fn(async () => ({ status: "cleared" })),
        save: vi.fn(async () => ({ status: "saved" })),
        dispose: vi.fn(async () => {}),
    };
}

/** Fake navigation：presentKeys 由测试控制（用于断言 prune 入参）。 */
function makeNavigation(present: () => Iterable<string>) {
    return {
        captureNavigation: () => undefined,
        restoreNavigation: () => undefined,
        presentKeys: present,
    };
}

/**
 * 用 fake 构造 bridge：把对象字面量类型的 fake 收窄到 `createSessionBridge` 的接口入参
 * （fake 故意不标注接口类型，见 makeStore 注释）。所有用例经此唯一入口装配。
 */
function build(opts: {
    store: ReturnType<typeof makeStore>;
    navigation: ReturnType<typeof makeNavigation>;
    subscribeNavigation?: (onChange: () => void) => () => void;
    debounceMs?: number;
    shouldRestore?: (snapshot: SessionSnapshot, currentUrl: string) => boolean;
}): BrowserSession {
    return createSessionBridge({
        ...opts,
        store: opts.store as unknown as SessionStore,
        navigation: opts.navigation as SessionNavigation,
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

describe("createSessionBridge — auto-capture", async () => {
    test("nav change debounces save (fires once after debounceMs)", async () => {
        const win = makeEventTarget();
        const doc = makeEventTarget();
        vi.stubGlobal("window", win);
        vi.stubGlobal("document", doc);

        let onChange: (() => void) | undefined;
        const store = makeStore();
        const bridge = build({
            store,
            navigation: makeNavigation(() => []),
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

        await bridge.dispose();
    });

    test("uses SESSION_DEFAULT_DEBOUNCE_MS when debounceMs omitted", async () => {
        vi.stubGlobal("window", makeEventTarget());
        vi.stubGlobal("document", makeEventTarget());

        let onChange: (() => void) | undefined;
        const store = makeStore();
        const bridge = build({
            store,
            navigation: makeNavigation(() => []),
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

        await bridge.dispose();
    });

    test("nav change prunes scope to presentKeys (pop B drops B before save)", async () => {
        vi.stubGlobal("window", makeEventTarget());
        vi.stubGlobal("document", makeEventTarget());

        let onChange: (() => void) | undefined;
        const store = makeStore();
        store.scope.set("A {}", { scroll: 10 });
        store.scope.set("B {}", { draft: "hi" });

        // pop B → present 仅剩 A。
        const bridge = build({
            store,
            navigation: makeNavigation(() => ["A {}"]),
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

        await bridge.dispose();
    });

    test("pagehide flushes immediately and cancels the pending debounce", async () => {
        const win = makeEventTarget();
        vi.stubGlobal("window", win);
        vi.stubGlobal("document", makeEventTarget());

        let onChange: (() => void) | undefined;
        const store = makeStore();
        const bridge = build({
            store,
            navigation: makeNavigation(() => []),
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

        await bridge.dispose();
    });

    test("visibilitychange flushes only when document is hidden", async () => {
        const doc = makeEventTarget() as ReturnType<typeof makeEventTarget> & {
            visibilityState: string;
        };
        doc.visibilityState = "visible";
        vi.stubGlobal("window", makeEventTarget());
        vi.stubGlobal("document", doc);

        const store = makeStore();
        const bridge = build({
            store,
            navigation: makeNavigation(() => []),
        });

        doc.visibilityState = "visible";
        doc.dispatch("visibilitychange");
        expect(store.save).not.toHaveBeenCalled(); // 可见 → 不落盘

        doc.visibilityState = "hidden";
        doc.dispatch("visibilitychange");
        expect(store.save).toHaveBeenCalledTimes(1); // 隐藏 → 立即落盘

        await bridge.dispose();
    });
});

// =====================================================================
// restore + shouldRestore 门控矩阵
// =====================================================================

describe("createSessionBridge — restore gate", async () => {
    function bridgeWith(loaded: SessionSnapshot | undefined): {
        store: ReturnType<typeof makeStore>;
        bridge: BrowserSession;
    } {
        vi.stubGlobal("window", makeEventTarget());
        vi.stubGlobal("document", makeEventTarget());
        const store = makeStore({ load: () => loaded });
        const bridge = build({ store, navigation: makeNavigation(() => []) });
        return { store, bridge };
    }

    test("no persisted snapshot → restore not called", async () => {
        const { store, bridge } = bridgeWith(undefined);
        await bridge.restoreFromUrl("/anything");
        expect(store.restore).not.toHaveBeenCalled();
        await bridge.dispose();
    });

    test("flat snapshot: same url → restored", async () => {
        const s = snap({
            navigation: { kind: "leaf", entryId: "fixture-home", intent: "home", params: {} },
            url: "/posts/7",
        });
        const { store, bridge } = bridgeWith(s);
        await bridge.restoreFromUrl("/posts/7");
        expect(store.restore).toHaveBeenCalledWith(s);
        await bridge.dispose();
    });

    test("flat snapshot: different deep-link url → NOT restored", async () => {
        const s = snap({
            navigation: { kind: "leaf", entryId: "fixture-home", intent: "home", params: {} },
            url: "/posts/7",
        });
        const { store, bridge } = bridgeWith(s);
        await bridge.restoreFromUrl("/posts/99");
        expect(store.restore).not.toHaveBeenCalled();
        await bridge.dispose();
    });

    test("flat snapshot: at root / → restored", async () => {
        const s = snap({
            navigation: { kind: "leaf", entryId: "fixture-home", intent: "home", params: {} },
            url: "/posts/7",
        });
        const { store, bridge } = bridgeWith(s);
        await bridge.restoreFromUrl("/?ref=x#frag");
        expect(store.restore).toHaveBeenCalledWith(s);
        await bridge.dispose();
    });

    test("structured snapshot: at root / → restored", async () => {
        const s = snap({
            navigation: { kind: "leaf", entryId: "fixture-home", intent: "home", params: {} },
        });
        const { store, bridge } = bridgeWith(s);
        await bridge.restoreFromUrl("/");
        expect(store.restore).toHaveBeenCalledWith(s);
        await bridge.dispose();
    });

    test("structured snapshot: at non-root /x → NOT restored", async () => {
        const s = snap({
            navigation: { kind: "leaf", entryId: "fixture-home", intent: "home", params: {} },
        });
        const { store, bridge } = bridgeWith(s);
        await bridge.restoreFromUrl("/x");
        expect(store.restore).not.toHaveBeenCalled();
        await bridge.dispose();
    });

    test("structured snapshot with url: same deep link → restored", async () => {
        const s = snap({
            navigation: {
                kind: "leaf",
                entryId: "fixture-detail",
                intent: "detail",
                params: { id: "1" },
            },
            url: "/item/1",
        });
        const { store, bridge } = bridgeWith(s);
        await bridge.restoreFromUrl("/item/1");
        expect(store.restore).toHaveBeenCalledWith(s);
        await bridge.dispose();
    });

    test("structured snapshot with url: different deep link → NOT restored", async () => {
        const s = snap({
            navigation: {
                kind: "leaf",
                entryId: "fixture-detail",
                intent: "detail",
                params: { id: "1" },
            },
            url: "/item/1",
        });
        const { store, bridge } = bridgeWith(s);
        await bridge.restoreFromUrl("/item/2");
        expect(store.restore).not.toHaveBeenCalled();
        await bridge.dispose();
    });

    test("slices-only snapshot (no navigation) → restored regardless of url", async () => {
        const s = snap({ slices: { theme: "dark" } });
        const { store, bridge } = bridgeWith(s);
        await bridge.restoreFromUrl("/deep/link");
        expect(store.restore).toHaveBeenCalledWith(s);
        await bridge.dispose();
    });

    test("custom shouldRestore overrides the default policy", async () => {
        const s = snap({
            navigation: { kind: "leaf", entryId: "fixture-home", intent: "home", params: {} },
            url: "/posts/7",
        });
        vi.stubGlobal("window", makeEventTarget());
        vi.stubGlobal("document", makeEventTarget());
        const store = makeStore({ load: () => s });
        const bridge = build({
            store,
            navigation: makeNavigation(() => []),
            shouldRestore: () => true, // 始终恢复，即便深链不匹配
        });
        await bridge.restoreFromUrl("/posts/99");
        expect(store.restore).toHaveBeenCalledWith(s);
        await bridge.dispose();
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
        const bridge = build({ store, navigation: makeNavigation(() => []) });
        await bridge.restoreFromUrl("/");
        expect(resolved).toBe(true);
        await bridge.dispose();
    });
});

// =====================================================================
// 手动逃生口 + dispose
// =====================================================================

describe("createSessionBridge — handle + dispose", async () => {
    test("uses the store itself and cancels scheduled saves on clear", async () => {
        vi.stubGlobal("window", makeEventTarget());
        vi.stubGlobal("document", makeEventTarget());
        const store = makeStore();
        const clear = store.clear;
        const bridge = build({ store, navigation: makeNavigation(() => []) });
        expect(bridge).toBe(store);

        await bridge.save();
        expect(store.save).toHaveBeenCalledTimes(1);
        await bridge.clear();
        expect(clear).toHaveBeenCalledTimes(1);

        await bridge.dispose();
    });

    test("dispose removes listeners, unsubscribes nav, and clears the timer", async () => {
        const win = makeEventTarget();
        const doc = makeEventTarget();
        vi.stubGlobal("window", win);
        vi.stubGlobal("document", doc);

        let onChange: (() => void) | undefined;
        const unsub = vi.fn();
        const store = makeStore();
        const bridge = build({
            store,
            navigation: makeNavigation(() => []),
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
        await bridge.dispose();

        // 取消订阅 + 解绑全部监听 + 清挂起定时器。
        expect(unsub).toHaveBeenCalledTimes(1);
        expect(win.listenerCount("pagehide")).toBe(0);
        expect(doc.listenerCount("visibilitychange")).toBe(0);

        vi.advanceTimersByTime(1000);
        expect(store.save).toHaveBeenCalledTimes(1); // pending debounce flushed before shutdown

        // dispose 后再 dispatch 事件无副作用。
        win.dispatch("pagehide");
        doc.dispatch("visibilitychange");
        expect(store.save).toHaveBeenCalledTimes(1);
    });
});

// =====================================================================
// defaultShouldRestore（直接单测策略边界）
// =====================================================================

describe("defaultShouldRestore", async () => {
    test("structural snapshot URL: same url true, different false, root true", async () => {
        const s = snap({
            navigation: { kind: "leaf", entryId: "fixture-home", intent: "home", params: {} },
            url: "/a/b",
        });
        expect(defaultShouldRestore(s, "/a/b")).toBe(true); // 全等命中（重载同 URL）
        expect(defaultShouldRestore(s, "/a/c")).toBe(false); // 不同深链 → 跳过
        expect(defaultShouldRestore(s, "/")).toBe(true); // 根入口 → 恢复
        expect(defaultShouldRestore(s, "/?q=1#h")).toBe(true); // 根判定剥离 query/hash
    });

    test("structured (no url): root true, non-root false（旧快照回退策略）", async () => {
        const s = snap({
            navigation: { kind: "leaf", entryId: "fixture-home", intent: "home", params: {} },
        });
        expect(defaultShouldRestore(s, "/")).toBe(true);
        expect(defaultShouldRestore(s, "/x")).toBe(false);
    });

    test("structured with comparable url: same true, different false, root true（与扁平对称）", async () => {
        const s = snap({
            navigation: {
                kind: "leaf",
                entryId: "fixture-detail",
                intent: "detail",
                params: { id: "1" },
            },
            url: "/item/1",
        });
        expect(defaultShouldRestore(s, "/item/1")).toBe(true); // 重载同深链 → 恢复
        expect(defaultShouldRestore(s, "/item/2")).toBe(false); // 改去别的深链 → 跳过
        expect(defaultShouldRestore(s, "/")).toBe(true); // 根入口 → 恢复
        expect(defaultShouldRestore(s, "/?q=1#h")).toBe(true); // 根判定剥离 query/hash
    });

    test("snapshot.url 优先于 nav.url（带 url 字段时以它为准）", async () => {
        // url 与 nav.url 不一致时，门控以 snapshot.url 为准（它是 capture 时刻的真实位置）。
        const s = snap({
            navigation: { kind: "leaf", entryId: "fixture-home", intent: "home", params: {} },
            url: "/item/9",
        });
        expect(defaultShouldRestore(s, "/item/9")).toBe(true);
        expect(defaultShouldRestore(s, "/stale")).toBe(false);
    });

    test("no navigation: always true", async () => {
        const s = snap({ slices: { a: 1 } });
        expect(defaultShouldRestore(s, "/anything/deep")).toBe(true);
    });
});

// =====================================================================
// createSessionBridge —— scope 暴露（导航作用域读写）
// =====================================================================

describe("createSessionBridge — scope handle", async () => {
    test("handle.scope 委托 store.scope（读写互通）", async () => {
        vi.stubGlobal("window", makeEventTarget());
        vi.stubGlobal("document", makeEventTarget());
        const store = makeStore();
        const bridge = build({ store, navigation: makeNavigation(() => []) });

        bridge.scope.set("home {}", { q: "hi" });
        expect(store.scope.get("home {}")).toEqual({ q: "hi" });
        expect(bridge.scope.get("home {}")).toEqual({ q: "hi" });
        await bridge.dispose();
    });

    test("handle.scope 始终取最新 store.scope 实例（restore 重建后不失效）", async () => {
        vi.stubGlobal("window", makeEventTarget());
        vi.stubGlobal("document", makeEventTarget());
        const store = makeStore();
        const bridge = build({ store, navigation: makeNavigation(() => []) });
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
        await bridge.dispose();
    });
});

test("startup pause prevents hydration events from overwriting persisted drafts and disposal awaits pending writes", async () => {
    vi.useRealTimers();
    const { createSessionStore } = await import("@finesoft/web");
    const win = makeEventTarget(),
        doc = makeEventTarget();
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    let releaseWrite!: () => void;
    const set = vi.fn(async () => {
        await new Promise<void>((resolve) => {
            releaseWrite = resolve;
        });
    });
    const store = createSessionStore({
        storage: { get: async () => undefined, set, delete: async () => {} },
    });
    let navigation!: () => void;
    const bridge = createSessionBridge({
        store,
        navigation: makeNavigation(() => []),
        debounceMs: 0,
        deferPersistenceUntilRestore: true,
        subscribeNavigation: (callback) => {
            navigation = callback;
            return () => {};
        },
    });
    navigation();
    win.dispatch("pagehide");
    expect(set).not.toHaveBeenCalled();
    expect(await bridge.restoreFromUrl("/")).toEqual({ status: "missing" });
    navigation();
    let closed = false;
    const closing = bridge.dispose().then(() => {
        closed = true;
    });
    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(closed).toBe(false);
    releaseWrite();
    await closing;
    expect(await bridge.save()).toEqual({ status: "closed" });
});
