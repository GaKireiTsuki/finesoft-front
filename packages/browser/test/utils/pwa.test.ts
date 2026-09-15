import { afterEach, test, expect, vi } from "vite-plus/test";
import { getPWADisplayMode } from "../../src/utils/pwa";
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
test("detects PWA display modes", () => {
    expect(getPWADisplayMode()).toBe("browser");

    vi.stubGlobal("window", {
        matchMedia: vi.fn(() => ({ matches: false })),
        navigator: {},
    });
    vi.stubGlobal("document", {
        referrer: "android-app://com.example.app",
    });
    expect(getPWADisplayMode()).toBe("twa");

    vi.stubGlobal("window", {
        matchMedia: vi.fn(() => ({ matches: true })),
        navigator: {},
    });
    vi.stubGlobal("document", { referrer: "" });
    expect(getPWADisplayMode()).toBe("standalone");

    vi.stubGlobal("window", {
        matchMedia: vi.fn(() => ({ matches: false })),
        navigator: { standalone: true },
    });
    vi.stubGlobal("document", { referrer: "" });
    expect(getPWADisplayMode()).toBe("standalone");

    vi.stubGlobal("window", {
        matchMedia: vi.fn(() => ({ matches: false })),
        navigator: {},
    });
    vi.stubGlobal("document", { referrer: "" });
    expect(getPWADisplayMode()).toBe("browser");
});
