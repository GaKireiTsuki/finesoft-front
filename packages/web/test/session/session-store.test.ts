import { describe, expect, test, vi } from "vite-plus/test";
import type { AsyncStorage } from "../../src/session/types";
import { createSessionStore } from "../../src/session/session-store";
import type { SessionNavigationAdapter } from "../../src/session/types";

function fakeStorage(): AsyncStorage {
    const m = new Map<string, string>();
    return {
        get: async (k) => m.get(k),
        set: async (k, v) => void m.set(k, v),
        delete: async (k) => void m.delete(k),
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

describe("SessionStore", async () => {
    test("capture collects nav + slices + scoped", async () => {
        const store = createSessionStore({
            storage: fakeStorage(),
            now: () => 5,
            navigation: fakeNav({ entryId: "fixture-flat", url: "/a" }),
        });
        store.register({
            key: "theme",
            version: 1,
            decode: (value: unknown) => value,
            capture: () => "dark",
            restore: () => {},
        });
        store.scope.set("home {}", { scroll: 9 });
        const s = store.capture();
        expect(s).toMatchObject({
            version: 1,
            navigation: { entryId: "fixture-flat", url: "/a" },
            slices: { theme: { version: 1, data: "dark" } },
            scoped: { "home {}": { scroll: 9 } },
            capturedAt: 5,
        });
    });

    test("capture records the comparable url from adapter.captureUrl", async () => {
        const store = createSessionStore({
            storage: fakeStorage(),
            now: () => 5,
            navigation: {
                ...fakeNav({
                    kind: "leaf",
                    entryId: "fixture-detail",
                    intent: "detail",
                    params: { id: "1" },
                }),
                captureUrl: () => "/item/1",
            },
        });
        expect(store.capture().url).toBe("/item/1");
    });

    test("capture omits url when the adapter has no captureUrl", async () => {
        const store = createSessionStore({
            storage: fakeStorage(),
            now: () => 5,
            navigation: fakeNav({ entryId: "fixture-flat", url: "/a" }),
        });
        expect(store.capture().url).toBeUndefined();
    });

    test("persist → load round-trip", async () => {
        const storage = fakeStorage();
        const store = createSessionStore({ storage, now: () => 1 });
        store.register({
            key: "q",
            version: 1,
            decode: (value: unknown) => value,
            capture: () => "x",
            restore: () => {},
        });
        await store.save();
        expect(await store.load()).toMatchObject({
            status: "loaded",
            snapshot: { slices: { q: { version: 1, data: "x" } } },
        });
    });

    test("restore applies nav + scoped + slices", async () => {
        const storage = fakeStorage();
        const restored: string[] = [];
        const nav = fakeNav(undefined);
        const store = createSessionStore({ storage, navigation: nav, now: () => 1 });
        store.register({
            key: "draft",
            version: 1,
            decode: (value: unknown) => value,
            capture: () => "",
            restore: (d) => {
                restored.push(d as string);
            },
        });
        await storage.set(
            "__finesoft_session__",
            JSON.stringify({
                version: 1,
                navigation: { entryId: "fixture-flat", url: "/x" },
                slices: { draft: { version: 1, data: "hello" } },
                scoped: { "k {}": 1 },
                capturedAt: 1,
            }),
        );
        await store.restore();
        expect(restored).toEqual(["hello"]);
        expect(store.scope.get("k {}")).toBe(1);
    });

    test("maxAgeMs expiry → load undefined", async () => {
        const storage = fakeStorage();
        const a = createSessionStore({ storage, now: () => 0 });
        await a.save();
        const b = createSessionStore({ storage, now: () => 10_000, maxAgeMs: 5000 });
        expect(await b.load()).toEqual({ status: "expired" });
    });

    test("version mismatch → load undefined", async () => {
        const storage = fakeStorage();
        await createSessionStore({ storage, version: 1, now: () => 1 }).save();
        expect(await createSessionStore({ storage, version: 2 }).load()).toEqual({
            status: "invalid",
        });
    });

    test("provider capture throw isolated (onError, other slices survive)", async () => {
        const onError = vi.fn();
        const store = createSessionStore({ storage: fakeStorage(), onError, now: () => 1 });
        store.register({
            key: "boom",
            version: 1,
            decode: (value: unknown) => value,
            capture: () => {
                throw new Error("x");
            },
            restore: () => {},
        });
        store.register({
            key: "ok",
            version: 1,
            decode: (value: unknown) => value,
            capture: () => 1,
            restore: () => {},
        });
        expect(store.capture().slices).toEqual({ ok: { version: 1, data: 1 } });
        expect(onError).toHaveBeenCalledOnce();
    });

    test("clear removes persisted snapshot", async () => {
        const storage = fakeStorage();
        const store = createSessionStore({ storage, now: () => 1 });
        await store.save();
        await store.clear();
        expect(await store.load()).toEqual({ status: "missing" });
    });

    test("restore isolates a synchronous adapter.apply throw (onError, no crash)", async () => {
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
            version: 1,
            decode: (value: unknown) => value,
            capture: () => "",
            restore: (d) => {
                restored.push(d as string);
            },
        });
        const snapshot = {
            version: 1,
            navigation: { kind: "tampered" } as never,
            slices: { draft: { version: 1, data: "hello" } },
            scoped: { "k {}": 1 },
            capturedAt: 1,
        };

        expect(await store.restore(snapshot)).toMatchObject({ status: "invalid" });
        expect(onError).toHaveBeenCalledOnce();
        expect(onError.mock.calls[0]?.[1]).toMatchObject({ phase: "restore" });
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
            version: 1,
            decode: (value: unknown) => value,
            capture: () => "",
            restore: (d) => {
                restored.push(d as string);
            },
        });
        const snapshot = {
            version: 1,
            navigation: { kind: "stack", entries: [] } as never,
            slices: { draft: { version: 1, data: "hello" } },
            scoped: { "k {}": 1 },
            capturedAt: 1,
        };

        await expect(store.restore(snapshot)).resolves.toMatchObject({ status: "failed" });
        expect(onError).toHaveBeenCalledOnce();
        expect(onError.mock.calls[0]?.[1]).toMatchObject({ phase: "restore" });
        expect(restored).toEqual([]);
    });
});
