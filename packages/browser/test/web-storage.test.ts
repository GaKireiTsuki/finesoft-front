vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { createWebStorage } from "../src/web-storage";

/** 一个最小的内存 Web Storage 伪实现，覆盖 createWebStorage 实际触达的成员。 */
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

describe("createWebStorage", async () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe("backed by an available Web Storage", async () => {
        beforeEach(() => {
            vi.stubGlobal("window", {
                sessionStorage: fakeWebStorage(),
                localStorage: fakeWebStorage(),
            });
        });

        test("set then get round-trips through sessionStorage", async () => {
            const storage = createWebStorage("session");
            await storage.set("k", "hello");
            expect(await storage.get("k")).toBe("hello");
        });

        test("get of a missing key returns undefined (not null)", async () => {
            const storage = createWebStorage("session");
            expect(await storage.get("missing")).toBeUndefined();
        });

        test("delete removes the key", async () => {
            const storage = createWebStorage("local");
            await storage.set("k", "v");
            await storage.delete("k");
            expect(await storage.get("k")).toBeUndefined();
        });

        test('kind "session" and "local" target distinct Web Storage areas', async () => {
            const session = createWebStorage("session");
            const local = createWebStorage("local");
            await session.set("k", "from-session");
            await local.set("k", "from-local");
            expect(await session.get("k")).toBe("from-session");
            expect(await local.get("k")).toBe("from-local");
        });

        test("set rejects a quota error from setItem", async () => {
            const throwing = fakeWebStorage();
            throwing.setItem = () => {
                throw new DOMException("quota exceeded", "QuotaExceededError");
            };
            vi.stubGlobal("window", { sessionStorage: throwing, localStorage: fakeWebStorage() });
            const storage = createWebStorage("session");
            await expect(storage.set("k", "v")).rejects.toThrow();
        });
    });

    describe("when the chosen Web Storage is unavailable", async () => {
        test("accessing storage throws → unavailable rejections", async () => {
            vi.stubGlobal("window", {
                get sessionStorage(): Storage {
                    throw new DOMException("access denied", "SecurityError");
                },
                localStorage: fakeWebStorage(),
            });
            const storage = createWebStorage("session");
            await expect(storage.set("k", "v")).rejects.toThrow();
            await expect(storage.delete("k")).rejects.toThrow();
            await expect(storage.get("k")).rejects.toThrow("storage-unavailable");
        });

        test("storage is undefined → unavailable storage", async () => {
            vi.stubGlobal("window", { sessionStorage: undefined, localStorage: undefined });
            const storage = createWebStorage("local");
            await expect(storage.set("k", "v")).rejects.toThrow("storage-unavailable");
            await expect(storage.get("k")).rejects.toThrow("storage-unavailable");
        });

        test("no global window at all → unavailable storage", async () => {
            vi.stubGlobal("window", undefined);
            const storage = createWebStorage("session");
            await expect(storage.set("k", "v")).rejects.toThrow();
            await expect(storage.get("k")).rejects.toThrow("storage-unavailable");
        });
    });
});

test("SessionStore distinguishes unavailable storage from saved and missing", async () => {
    const { createSessionStore } = await import("@finesoft/web");
    vi.stubGlobal("window", undefined);
    try {
        const store = createSessionStore({ storage: createWebStorage("session") });
        expect(await store.save()).toEqual({ status: "unavailable" });
        expect(await store.load()).toEqual({ status: "unavailable" });
        expect(await store.clear()).toEqual({ status: "unavailable" });
    } finally {
        vi.unstubAllGlobals();
    }
});
