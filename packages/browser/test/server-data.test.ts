import { afterEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import {
    createPrefetchedIntentsFromDom,
    deserializeServerData,
    SERVER_DATA_ID,
} from "../src/server-data";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("server data helpers", () => {
    test("returns undefined when no server data script is present", () => {
        vi.stubGlobal("document", {
            getElementById: vi.fn(() => null),
        });

        expect(deserializeServerData()).toBeUndefined();
    });

    test("deserializes valid embedded server data and removes the script", () => {
        const removeChild = vi.fn();
        const script = {
            textContent: JSON.stringify([
                {
                    intent: { id: "home", params: { page: "1" } },
                    data: { title: "Home" },
                },
            ]),
            parentNode: { removeChild },
        };

        vi.stubGlobal("document", {
            getElementById: vi.fn((id: string) => (id === SERVER_DATA_ID ? script : null)),
        });

        expect(deserializeServerData()).toEqual([
            {
                intent: { id: "home", params: { page: "1" } },
                data: { title: "Home" },
            },
        ]);
        expect(removeChild).toHaveBeenCalledWith(script);
    });

    test("returns undefined for invalid JSON payloads", () => {
        const script = {
            textContent: "{not-json}",
            parentNode: { removeChild: vi.fn() },
        };

        vi.stubGlobal("document", {
            getElementById: vi.fn(() => script),
        });

        expect(deserializeServerData()).toBeUndefined();
    });

    test("creates PrefetchedIntents instances from DOM data", () => {
        const removeChild = vi.fn();
        const script = {
            textContent: JSON.stringify([
                {
                    intent: { id: "product", params: { a: "1", b: "2" } },
                    data: { title: "Product" },
                },
            ]),
            parentNode: { removeChild },
        };

        vi.stubGlobal("document", {
            getElementById: vi.fn(() => script),
        });

        const prefetched = createPrefetchedIntentsFromDom();

        expect(prefetched.has({ id: "product", params: { b: "2", a: "1" } })).toBe(true);
        expect(prefetched.get({ id: "product", params: { a: "1", b: "2" } })).toEqual({
            title: "Product",
        });
    });

    test("returns an empty cache when the embedded payload is not an array", () => {
        vi.stubGlobal("document", {
            getElementById: vi.fn(() => ({
                textContent: JSON.stringify({ invalid: true }),
                parentNode: { removeChild: vi.fn() },
            })),
        });

        const prefetched = createPrefetchedIntentsFromDom();

        expect(prefetched.size).toBe(0);
    });
});
