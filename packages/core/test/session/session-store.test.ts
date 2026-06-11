import { describe, expect, test, vi } from "vite-plus/test";
import type { Storage } from "../../src/dependencies/make-dependencies";
import { createSessionStore } from "../../src/session/session-store";
import type { SessionNavigationAdapter } from "../../src/session/types";

function fakeStorage(): Storage {
    const m = new Map<string, string>();
    return {
        get: (k) => m.get(k),
        set: (k, v) => void m.set(k, v),
        delete: (k) => void m.delete(k),
    };
}

function fakeNav(initial: unknown): SessionNavigationAdapter {
    let nav = initial;
    const present = new Set<string>();
    return {
        capture: () => nav as never,
        apply: (n) => {
            nav = n;
        },
        presentKeys: () => present,
    };
}

describe("SessionStore", () => {
    test("capture collects nav + slices + scoped", () => {
        const store = createSessionStore({
            storage: fakeStorage(),
            now: () => 5,
            navigation: fakeNav({ url: "/a" }),
        });
        store.register({ key: "theme", capture: () => "dark", restore: () => {} });
        store.scope.set("home {}", { scroll: 9 });
        const s = store.capture();
        expect(s).toMatchObject({
            version: 1,
            navigation: { url: "/a" },
            slices: { theme: "dark" },
            scoped: { "home {}": { scroll: 9 } },
            capturedAt: 5,
        });
    });

    test("capture records the comparable url from adapter.captureUrl", () => {
        const store = createSessionStore({
            storage: fakeStorage(),
            now: () => 5,
            navigation: {
                ...fakeNav({ kind: "leaf", intent: "detail", params: { id: "1" } }),
                captureUrl: () => "/item/1",
            },
        });
        expect(store.capture().url).toBe("/item/1");
    });

    test("capture omits url when the adapter has no captureUrl", () => {
        const store = createSessionStore({
            storage: fakeStorage(),
            now: () => 5,
            navigation: fakeNav({ url: "/a" }),
        });
        expect(store.capture().url).toBeUndefined();
    });

    test("persist → load round-trip", () => {
        const storage = fakeStorage();
        const store = createSessionStore({ storage, now: () => 1 });
        store.register({ key: "q", capture: () => "x", restore: () => {} });
        store.save();
        expect(store.load()?.slices).toEqual({ q: "x" });
    });

    test("restore applies nav + scoped + slices", async () => {
        const storage = fakeStorage();
        const restored: string[] = [];
        const nav = fakeNav(undefined);
        const store = createSessionStore({ storage, navigation: nav, now: () => 1 });
        store.register({
            key: "draft",
            capture: () => "",
            restore: (d) => restored.push(d as string),
        });
        storage.set(
            "__finesoft_session__",
            JSON.stringify({
                version: 1,
                navigation: { url: "/x" },
                slices: { draft: "hello" },
                scoped: { "k {}": 1 },
                capturedAt: 1,
            }),
        );
        await store.restore();
        expect(restored).toEqual(["hello"]);
        expect(store.scope.get("k {}")).toBe(1);
    });

    test("maxAgeMs expiry → load undefined", () => {
        const storage = fakeStorage();
        const a = createSessionStore({ storage, now: () => 0 });
        a.save();
        const b = createSessionStore({ storage, now: () => 10_000, maxAgeMs: 5000 });
        expect(b.load()).toBeUndefined();
    });

    test("version mismatch → load undefined", () => {
        const storage = fakeStorage();
        createSessionStore({ storage, version: 1, now: () => 1 }).save();
        expect(createSessionStore({ storage, version: 2 }).load()).toBeUndefined();
    });

    test("provider capture throw isolated (onError, other slices survive)", () => {
        const onError = vi.fn();
        const store = createSessionStore({ storage: fakeStorage(), onError, now: () => 1 });
        store.register({
            key: "boom",
            capture: () => {
                throw new Error("x");
            },
            restore: () => {},
        });
        store.register({ key: "ok", capture: () => 1, restore: () => {} });
        expect(store.capture().slices).toEqual({ ok: 1 });
        expect(onError).toHaveBeenCalledOnce();
    });

    test("clear removes persisted snapshot", () => {
        const storage = fakeStorage();
        const store = createSessionStore({ storage, now: () => 1 });
        store.save();
        store.clear();
        expect(store.load()).toBeUndefined();
    });

    test("restore isolates a synchronous adapter.apply throw (onError, no crash)", () => {
        const onError = vi.fn();
        const restored: string[] = [];
        const nav: SessionNavigationAdapter = {
            capture: () => undefined,
            apply: () => {
                throw new Error("malformed navigation blob");
            },
            presentKeys: () => [],
        };
        const store = createSessionStore({
            storage: fakeStorage(),
            navigation: nav,
            onError,
            now: () => 1,
        });
        store.register({
            key: "draft",
            capture: () => "",
            restore: (d) => restored.push(d as string),
        });
        const snapshot = {
            version: 1,
            navigation: { kind: "tampered" } as never,
            slices: { draft: "hello" },
            scoped: { "k {}": 1 },
            capturedAt: 1,
        };

        expect(() => store.restore(snapshot)).not.toThrow();
        expect(onError).toHaveBeenCalledOnce();
        expect(onError.mock.calls[0]?.[1]).toEqual({ phase: "restore" });
        // 导航失败 → 跳过 slice 回填（对齐 provider 隔离的安全默认）。
        expect(restored).toEqual([]);
    });

    test("restore isolates an asynchronous adapter.apply rejection (onError, no reject)", async () => {
        const onError = vi.fn();
        const restored: string[] = [];
        const nav: SessionNavigationAdapter = {
            capture: () => undefined,
            apply: () => Promise.reject(new Error("hydrate failed")),
            presentKeys: () => [],
        };
        const store = createSessionStore({
            storage: fakeStorage(),
            navigation: nav,
            onError,
            now: () => 1,
        });
        store.register({
            key: "draft",
            capture: () => "",
            restore: (d) => restored.push(d as string),
        });
        const snapshot = {
            version: 1,
            navigation: { kind: "stack", entries: [] } as never,
            slices: { draft: "hello" },
            scoped: { "k {}": 1 },
            capturedAt: 1,
        };

        await expect(store.restore(snapshot)).resolves.toBeUndefined();
        expect(onError).toHaveBeenCalledOnce();
        expect(onError.mock.calls[0]?.[1]).toEqual({ phase: "restore" });
        expect(restored).toEqual([]);
    });
});
