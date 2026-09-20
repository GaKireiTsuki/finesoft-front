import { expect, test, vi } from "vite-plus/test";
vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));
import { createPrefetchedIntentsFromDom, deserializeServerData } from "../src/server-data";
const payload = [
    {
        entryId: "home-1",
        intent: { id: "home", params: {} },
        data: { pageType: "home", title: "Home" },
    },
];
const tree = { kind: "leaf", entryId: "home-1", intent: "home", params: {} };
function source(value: unknown) {
    const removeChild = vi.fn();
    return {
        removeChild,
        buildId: "build-a",
        script: {
            textContent: JSON.stringify(value),
            parentNode: { removeChild },
        } as unknown as HTMLScriptElement,
    };
}
test("explicit per-instance sources never query global document; each consumes only its own script", () => {
    const a = source({ protocolVersion: 2, buildId: "build-a", payload: { tree, pages: payload } });
    const b = source({
        protocolVersion: 2,
        buildId: "build-a",
        payload: {
            tree: { ...tree, entryId: "home-2" },
            pages: [{ ...payload[0], entryId: "home-2" }],
        },
    });
    const cache = createPrefetchedIntentsFromDom(a);
    expect(cache.get({ id: "home", params: {} }, "home-1")).toEqual({
        pageType: "home",
        title: "Home",
    });
    expect(b.removeChild).not.toHaveBeenCalled();
    expect(deserializeServerData(b)).toEqual({
        status: "ready",
        data: {
            tree: { ...tree, entryId: "home-2" },
            pages: [{ ...payload[0], entryId: "home-2" }],
        },
    });
});
test("missing, invalid JSON and mismatches explicitly fall back to fresh load", () => {
    expect(deserializeServerData({ script: null })).toEqual({
        status: "fresh-load",
        code: "missing",
    });
    const invalid = source(null);
    invalid.script.textContent = "bad json";
    expect(deserializeServerData(invalid)).toEqual({ status: "fresh-load", code: "invalid-json" });
    const onFallback = vi.fn();
    const cache = createPrefetchedIntentsFromDom({
        ...source({ protocolVersion: 2, buildId: "old", payload: { tree, pages: payload } }),
        onFallback,
    });
    expect(cache.size).toBe(0);
    expect(onFallback).toHaveBeenCalledWith("build-mismatch");
});

test("a changed build rejects hydration while preserving independently versioned persisted drafts", async () => {
    const { createSessionStore } = await import("@finesoft/web");
    const restore = vi.fn();
    const stored = JSON.stringify({
        version: 2,
        capturedAt: 1,
        scoped: {},
        slices: { draft: { version: 3, data: "kept" } },
    });
    const store = createSessionStore({
        storage: { get: async () => stored, set: async () => {}, delete: async () => {} },
    });
    store.register({
        key: "draft",
        version: 3,
        capture: () => "",
        decode: (value) => {
            if (typeof value !== "string") throw Error("invalid");
            return value;
        },
        restore,
    });
    expect(
        createPrefetchedIntentsFromDom(
            source({ protocolVersion: 2, buildId: "old-build", payload: { tree, pages: payload } }),
        ).size,
    ).toBe(0);
    expect(await store.restore()).toEqual({ status: "restored" });
    expect(restore).toHaveBeenCalledWith("kept");
    await store.dispose();
});
