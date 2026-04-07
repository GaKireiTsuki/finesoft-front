import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import {
    getLocaleAttributes,
    getTextDirection,
    isRtl,
    makeLocaleInfo,
    resolveLocaleFromUrl,
    setHtmlLocaleAttributes,
} from "../../src/i18n/locale";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("locale helpers", () => {
    test("detects RTL and LTR languages", () => {
        expect(isRtl("ar-SA")).toBe(true);
        expect(isRtl("EN-us")).toBe(false);
        expect(getTextDirection("he-IL")).toBe("rtl");
        expect(getTextDirection("ja-JP")).toBe("ltr");
    });

    test("creates locale attributes and locale info", () => {
        expect(getLocaleAttributes("fa-IR")).toEqual({
            lang: "fa-IR",
            dir: "rtl",
        });
        expect(makeLocaleInfo("zh-Hans", "CN")).toEqual({
            language: "zh-Hans",
            region: "CN",
            bcp47: "zh-Hans-CN",
            dir: "ltr",
        });
        expect(makeLocaleInfo("en")).toEqual({
            language: "en",
            region: undefined,
            bcp47: "en",
            dir: "ltr",
        });
    });

    test("applies locale attributes to the html element", () => {
        vi.stubGlobal("document", {
            documentElement: {
                lang: "",
                dir: "",
            },
        });

        setHtmlLocaleAttributes({ lang: "ar-SA", dir: "rtl" });

        expect(document.documentElement.lang).toBe("ar-SA");
        expect(document.documentElement.dir).toBe("rtl");
    });

    test("extracts supported locales from URLs", () => {
        expect(resolveLocaleFromUrl("/ZH/about?from=nav", ["zh", "en"])).toEqual({
            locale: "zh",
            strippedUrl: "/about",
        });
        expect(resolveLocaleFromUrl("/en", ["zh", "en"])).toEqual({
            locale: "en",
            strippedUrl: "/",
        });
        expect(resolveLocaleFromUrl("/about", ["zh", "en"])).toBeNull();
    });
});
