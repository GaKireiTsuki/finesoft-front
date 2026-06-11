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

describe("createWebStorage", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe("backed by an available Web Storage", () => {
        beforeEach(() => {
            vi.stubGlobal("window", {
                sessionStorage: fakeWebStorage(),
                localStorage: fakeWebStorage(),
            });
        });

        test("set then get round-trips through sessionStorage", () => {
            const storage = createWebStorage("session");
            storage.set("k", "hello");
            expect(storage.get("k")).toBe("hello");
        });

        test("get of a missing key returns undefined (not null)", () => {
            const storage = createWebStorage("session");
            expect(storage.get("missing")).toBeUndefined();
        });

        test("delete removes the key", () => {
            const storage = createWebStorage("local");
            storage.set("k", "v");
            storage.delete("k");
            expect(storage.get("k")).toBeUndefined();
        });

        test('kind "session" and "local" target distinct Web Storage areas', () => {
            const session = createWebStorage("session");
            const local = createWebStorage("local");
            session.set("k", "from-session");
            local.set("k", "from-local");
            expect(session.get("k")).toBe("from-session");
            expect(local.get("k")).toBe("from-local");
        });

        test("set swallows a quota error from setItem", () => {
            const throwing = fakeWebStorage();
            throwing.setItem = () => {
                throw new DOMException("quota exceeded", "QuotaExceededError");
            };
            vi.stubGlobal("window", { sessionStorage: throwing, localStorage: fakeWebStorage() });
            const storage = createWebStorage("session");
            expect(() => storage.set("k", "v")).not.toThrow();
        });
    });

    describe("when the chosen Web Storage is unavailable", () => {
        test("accessing storage throws → no-op Storage (get undefined, set/delete silent)", () => {
            vi.stubGlobal("window", {
                get sessionStorage(): Storage {
                    throw new DOMException("access denied", "SecurityError");
                },
                localStorage: fakeWebStorage(),
            });
            const storage = createWebStorage("session");
            expect(() => storage.set("k", "v")).not.toThrow();
            expect(() => storage.delete("k")).not.toThrow();
            expect(storage.get("k")).toBeUndefined();
        });

        test("storage is undefined → no-op Storage", () => {
            vi.stubGlobal("window", { sessionStorage: undefined, localStorage: undefined });
            const storage = createWebStorage("local");
            storage.set("k", "v");
            expect(storage.get("k")).toBeUndefined();
        });

        test("no global window at all → no-op Storage", () => {
            vi.stubGlobal("window", undefined);
            const storage = createWebStorage("session");
            expect(() => storage.set("k", "v")).not.toThrow();
            expect(storage.get("k")).toBeUndefined();
        });
    });
});
