import { afterEach, describe, expect, test, vi } from "vite-plus/test";

afterEach(() => {
    delete process.env.FINESOFT_DEBUG;
    vi.restoreAllMocks();
    vi.resetModules();
});

describe("dynamicImport", () => {
    test("caches built-in modules and emits debug logs when debugging is enabled", async () => {
        process.env.FINESOFT_DEBUG = "1";
        const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
        vi.resetModules();

        const { dynamicImport } = await import("../src/dynamic-import");

        const first = await dynamicImport("node:path");
        const second = await dynamicImport("node:path");

        expect(first).toBe(second);
        expect(debug).toHaveBeenCalledWith("[finesoft:dynamic-import] importing  → node:path");
        expect(debug).toHaveBeenCalledWith("[finesoft:dynamic-import] cache hit  → node:path");
    });
});
