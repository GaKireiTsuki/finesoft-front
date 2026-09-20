import { describe, expect, test, vi } from "vite-plus/test";
import type { AsyncStorage } from "../../src/session/types";
import { createSessionStore } from "../../src/session/session-store";
import type { SessionNavigation } from "../../src/session/types";

function fakeStorage(): AsyncStorage {
    const m = new Map<string, string>();
    return {
        get: async (k) => m.get(k),
        set: async (k, v) => void m.set(k, v),
        delete: async (k) => void m.delete(k),
    };
}

function fakeNav(initial: unknown): SessionNavigation {
    let nav = initial;
    const present = new Set<string>();
    return {
        captureNavigation: () => nav as never,
        restoreNavigation: (n) => {
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
            navigation: fakeNav({
                kind: "leaf",
                entryId: "fixture-home",
                intent: "home",
                params: {},
            }),
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
            version: 2,
            navigation: { kind: "leaf", entryId: "fixture-home", intent: "home", params: {} },
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
            navigation: fakeNav({
                kind: "leaf",
                entryId: "fixture-home",
                intent: "home",
                params: {},
            }),
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
                version: 2,
                navigation: { kind: "leaf", entryId: "fixture-home", intent: "home", params: {} },
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

    test("coalesces adjacent queued implicit saves and captures when the slot starts", async () => {
        let release!: () => void;
        const writes: string[] = [];
        const storage: AsyncStorage = {
            get: async () => undefined,
            set: async (_key, value) => {
                writes.push(value);
                if (writes.length === 1) await new Promise<void>((resolve) => (release = resolve));
            },
            delete: async () => {},
        };
        let value = "first";
        let captures = 0;
        const store = createSessionStore({ storage });
        store.register({
            key: "value",
            version: 1,
            decode: (input) => input,
            capture: () => {
                captures++;
                return value;
            },
            restore: () => {},
        });
        const active = store.save();
        value = "latest";
        const joined = Array.from({ length: 19 }, () => store.save());
        for (const pending of joined) expect(pending).toBe(active);
        await Promise.resolve();
        release();
        await active;
        expect(JSON.parse(writes[0]).slices.value.data).toBe("latest");
        expect(writes).toHaveLength(1);
        expect(captures).toBe(1);
    });

    test("explicit, clear, and load calls delimit implicit save batching", async () => {
        const storage = fakeStorage();
        const store = createSessionStore({ storage });
        const first = store.save();
        const explicit = store.persist({ version: 2, slices: {}, scoped: {}, capturedAt: 1 });
        const afterExplicit = store.save();
        const loaded = store.load();
        const afterLoad = store.save();
        const cleared = store.clear();
        const afterClear = store.save();
        expect(
            new Set([first, explicit, afterExplicit, loaded, afterLoad, cleared, afterClear]).size,
        ).toBe(7);
        await Promise.all([first, explicit, afterExplicit, loaded, afterLoad, cleared, afterClear]);
    });

    test("restore isolates a synchronous navigation.restoreNavigation throw (onError, no crash)", async () => {
        const onError = vi.fn();
        const restored: string[] = [];
        const nav: SessionNavigation = {
            captureNavigation: () => undefined,
            restoreNavigation: () => {
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

    test("restore isolates an asynchronous navigation.restoreNavigation rejection (onError, no reject)", async () => {
        const onError = vi.fn();
        const restored: string[] = [];
        const nav: SessionNavigation = {
            captureNavigation: () => undefined,
            restoreNavigation: () => Promise.reject(new Error("hydrate failed")),
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
            version: 2,
            navigation: { kind: "leaf", entryId: "fixture-home", intent: "home", params: {} },
            slices: { draft: { version: 1, data: "hello" } },
            scoped: { "k {}": 1 },
            capturedAt: 1,
        };

        await expect(store.restore(snapshot as never)).resolves.toMatchObject({ status: "failed" });
        expect(onError).toHaveBeenCalledOnce();
        expect(onError.mock.calls[0]?.[1]).toMatchObject({ phase: "restore" });
        expect(restored).toEqual([]);
    });
});
