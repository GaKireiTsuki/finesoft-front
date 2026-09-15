import { afterEach, test, expect, vi } from "vite-plus/test";
import { shouldLog, resetFilterCache } from "../../src/logger/local-storage-filter";
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
test("evaluates localStorage logging rules and tolerates storage errors", () => {
    vi.stubGlobal("localStorage", {
        getItem: vi.fn(() => "*=info,Foo=off,Bar=error"),
    });

    expect(shouldLog("Any", "debug")).toBe(false);
    expect(shouldLog("Any", "info")).toBe(true);
    expect(shouldLog("Foo", "error")).toBe(false);
    expect(shouldLog("Bar", "warn")).toBe(false);
    expect(shouldLog("Bar", "error")).toBe(true);
    expect(shouldLog("Baz", "debug")).toBe(false);

    vi.stubGlobal("localStorage", {
        getItem: vi.fn(() => "Foo=warn"),
    });
    resetFilterCache();

    expect(shouldLog("Bar", "debug")).toBe(true);

    vi.stubGlobal("localStorage", {
        getItem: vi.fn(() => {
            throw new Error("denied");
        }),
    });
    resetFilterCache();

    expect(shouldLog("Any", "debug")).toBe(true);
});
