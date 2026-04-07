import { describe, expect, test } from "vite-plus/test";
import { parseAcceptLanguage } from "../src/locale";

describe("parseAcceptLanguage", () => {
    test("selects the highest-priority supported language by prefix", () => {
        expect(parseAcceptLanguage("fr-CA, zh-Hant;q=0.9, en-US;q=0.8", ["zh", "en"])).toBe("zh");
        expect(parseAcceptLanguage("EN-US;q=0.5, zh;q=0.2", ["zh", "en"])).toBe("en");
    });

    test("falls back when the header is missing, too large, or too fragmented", () => {
        expect(parseAcceptLanguage(undefined, ["en", "ja"], "ja")).toBe("ja");
        expect(parseAcceptLanguage("x".repeat(1025), ["en", "ja"], "ja")).toBe("ja");
        expect(
            parseAcceptLanguage(
                Array.from({ length: 51 }, (_, i) => `lang${i}`).join(","),
                ["en", "ja"],
                "ja",
            ),
        ).toBe("ja");
    });

    test("treats invalid q values as zero and returns the fallback when nothing matches", () => {
        expect(parseAcceptLanguage("de;q=wat, fr;q=2", ["zh", "en"], "en")).toBe("en");
    });
});
