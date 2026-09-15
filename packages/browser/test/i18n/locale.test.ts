import { afterEach, test, expect, vi } from "vite-plus/test";
import { setHtmlLocaleAttributes } from "../../src/i18n/locale";
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
