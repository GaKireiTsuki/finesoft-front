import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { isNone, isSome } from "../../src/utils/optional";
import { detectPlatform } from "../../src/utils/platform";
import { getPWADisplayMode } from "../../src/utils/pwa";
import {
    buildUrl,
    getBaseUrl,
    removeHost,
    removeQueryParams,
    removeScheme,
} from "../../src/utils/url";
import { generateUuid } from "../../src/utils/uuid";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("utility helpers", () => {
    test("handles URL helpers", () => {
        expect(removeScheme("https://example.com/path")).toBe("example.com/path");
        expect(removeHost("https://example.com/path?x=1#top")).toBe("/path?x=1#top");
        expect(removeHost("/already-relative")).toBe("/already-relative");
        expect(removeQueryParams("/products?sort=asc")).toBe("/products");
        expect(getBaseUrl("/products?sort=asc#top")).toBe("/products");
        expect(buildUrl("/products", { sort: "asc", page: undefined, q: "hat" })).toBe(
            "/products?sort=asc&q=hat",
        );
    });

    test("checks optional values", () => {
        expect(isSome("value")).toBe(true);
        expect(isSome(0)).toBe(true);
        expect(isNone(null)).toBe(true);
        expect(isNone(undefined)).toBe(true);
        expect(isNone("value")).toBe(false);
    });

    test("uses crypto.randomUUID when available", () => {
        const randomUUID = vi.fn(() => "fixed-uuid");
        vi.stubGlobal("crypto", { randomUUID });

        expect(generateUuid()).toBe("fixed-uuid");
        expect(randomUUID).toHaveBeenCalledTimes(1);
    });

    test("falls back to Math.random when crypto.randomUUID is unavailable", () => {
        vi.stubGlobal("crypto", {});
        vi.spyOn(Math, "random").mockReturnValue(0);

        expect(generateUuid()).toBe("00000000-0000-4000-8000-000000000000");
    });

    test("detects platforms from user agents", () => {
        vi.stubGlobal("navigator", {
            userAgent: "ignored",
            maxTouchPoints: 5,
        });

        expect(
            detectPlatform(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
            ),
        ).toEqual({
            os: "ios",
            browser: "safari",
            engine: "webkit",
            isMobile: true,
            isTouch: true,
        });

        vi.stubGlobal("navigator", {
            userAgent: "ignored",
            maxTouchPoints: 0,
        });

        expect(
            detectPlatform(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0",
            ),
        ).toMatchObject({
            os: "windows",
            browser: "edge",
            engine: "blink",
            isMobile: false,
            isTouch: false,
        });

        expect(
            detectPlatform(
                "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:136.0) Gecko/20100101 Firefox/136.0",
            ),
        ).toMatchObject({
            os: "linux",
            browser: "firefox",
            engine: "gecko",
        });

        vi.stubGlobal("navigator", {
            userAgent: "ignored",
            maxTouchPoints: 2,
        });

        expect(
            detectPlatform(
                "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/120.0.0.0 Mobile Safari/537.36",
            ),
        ).toMatchObject({
            os: "android",
            browser: "samsung",
            engine: "blink",
            isMobile: true,
            isTouch: true,
        });

        vi.stubGlobal("navigator", {
            userAgent: "ignored",
            maxTouchPoints: 0,
        });

        expect(detectPlatform("CustomAgent/1.0")).toMatchObject({
            os: "unknown",
            browser: "unknown",
            engine: "unknown",
            isMobile: false,
            isTouch: false,
        });
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
});
