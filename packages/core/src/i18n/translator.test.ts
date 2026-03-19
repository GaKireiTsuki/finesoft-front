import { describe, expect, test } from "vite-plus/test";
import { SimpleTranslator } from "./translator";

describe("SimpleTranslator.getUsedMessages", () => {
    test("returns empty object when no translations are used", () => {
        const t = new SimpleTranslator({
            locale: "zh-Hans",
            messages: { hello: "你好", world: "世界" },
        });

        expect(t.getUsedMessages()).toEqual({});
    });

    test("tracks used translation keys", () => {
        const t = new SimpleTranslator({
            locale: "zh-Hans",
            messages: { hello: "你好", world: "世界", goodbye: "再见" },
        });

        t.t("hello");
        t.t("world");

        expect(t.getUsedMessages()).toEqual({
            hello: "你好",
            world: "世界",
        });
    });

    test("does not include missing keys (fallback calls)", () => {
        const t = new SimpleTranslator({
            locale: "en",
            messages: { hello: "Hello" },
        });

        t.t("hello");
        t.t("missing_key");

        expect(t.getUsedMessages()).toEqual({
            hello: "Hello",
        });
    });

    test("tracks plural keys", () => {
        const t = new SimpleTranslator({
            locale: "en",
            messages: {
                "items.one": "{count} item",
                "items.other": "{count} items",
            },
        });

        t.plural("items", 1);
        t.plural("items", 5);

        expect(t.getUsedMessages()).toEqual({
            "items.one": "{count} item",
            "items.other": "{count} items",
        });
    });

    test("returns raw templates, not interpolated values", () => {
        const t = new SimpleTranslator({
            locale: "en",
            messages: { greeting: "Hello, {name}!" },
        });

        const result = t.t("greeting", { name: "World" });
        expect(result).toBe("Hello, World!");

        // getUsedMessages should return the raw template
        expect(t.getUsedMessages()).toEqual({
            greeting: "Hello, {name}!",
        });
    });

    test("deduplicates repeated key usage", () => {
        const t = new SimpleTranslator({
            locale: "en",
            messages: { hello: "Hello" },
        });

        t.t("hello");
        t.t("hello");
        t.t("hello");

        expect(t.getUsedMessages()).toEqual({ hello: "Hello" });
    });
});
