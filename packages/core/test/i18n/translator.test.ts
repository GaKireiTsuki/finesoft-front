import { describe, expect, test } from "vite-plus/test";
import { englishPlural, interpolate, resolvePluralKey } from "../../src/i18n/interpolate";
import { SimpleTranslator } from "../../src/i18n/translator";

describe("translator and interpolate helpers", () => {
    test("interpolates placeholders and preserves missing values", () => {
        expect(interpolate("Hello, {name}!", { name: "Megumi" })).toBe("Hello, Megumi!");
        expect(interpolate("{count} items for {name}", { count: 3 })).toBe("3 items for {name}");
        expect(interpolate("plain text")).toBe("plain text");
    });

    test("exposes plural helpers", () => {
        expect(englishPlural(1)).toBe("one");
        expect(englishPlural(2)).toBe("other");
        expect(resolvePluralKey("cart", "few")).toBe("cart.few");
    });

    test("translates keys and uses fallback for missing entries", () => {
        const translator = new SimpleTranslator({
            locale: "en-US",
            messages: {
                hello: "Hello, {name}!",
            },
            fallback: (key) => `missing:${key}`,
        });

        expect(translator.locale).toBe("en-US");
        expect(translator.t("hello", { name: "Megumi" })).toBe("Hello, Megumi!");
        expect(translator.t("unknown")).toBe("missing:unknown");
    });

    test("pluralizes using the configured plural rule", () => {
        const translator = new SimpleTranslator({
            locale: "ar",
            messages: {
                "cart.zero": "No items",
                "cart.one": "One item",
                "cart.other": "{count} items",
            },
            pluralRule: (count) => (count === 0 ? "zero" : count === 1 ? "one" : "other"),
        });

        expect(translator.plural("cart", 0)).toBe("No items");
        expect(translator.plural("cart", 1)).toBe("One item");
        expect(translator.plural("cart", 5)).toBe("5 items");
    });
});
