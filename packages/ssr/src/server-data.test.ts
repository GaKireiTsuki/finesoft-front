import { describe, expect, test } from "vite-plus/test";
import { serializeServerData } from "./server-data";

describe("serializeServerData", () => {
    test("serializes intents array (backward compatible)", () => {
        const intents = [{ intent: { id: "test", params: {} }, data: { title: "Hello" } }];
        const result = serializeServerData(intents);
        const parsed = JSON.parse(result);

        // Without i18n, returns a plain array (old format)
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toEqual(intents);
    });

    test("serializes intents with i18n data", () => {
        const intents = [{ intent: { id: "test", params: {} }, data: { title: "你好" } }];
        const i18n = {
            locale: "zh-Hans",
            messages: { hello: "你好", world: "世界" },
        };

        const result = serializeServerData(intents, i18n);
        const parsed = JSON.parse(result);

        // With i18n, returns an object with intents and i18n
        expect(Array.isArray(parsed)).toBe(false);
        expect(parsed.intents).toEqual(intents);
        expect(parsed.i18n).toEqual(i18n);
    });

    test("escapes HTML-dangerous characters in i18n messages", () => {
        const intents: never[] = [];
        const i18n = {
            locale: "en",
            messages: { danger: "<script>alert('xss')</script>" },
        };

        const result = serializeServerData(intents, i18n);

        // Should not contain raw < > /
        expect(result).not.toContain("<");
        expect(result).not.toContain(">");

        // But should be parseable and correct
        const parsed = JSON.parse(result);
        expect(parsed.i18n.messages.danger).toBe("<script>alert('xss')</script>");
    });

    test("omits i18n when undefined", () => {
        const intents = [{ intent: { id: "test", params: {} }, data: {} }];
        const result = serializeServerData(intents, undefined);
        const parsed = JSON.parse(result);

        expect(Array.isArray(parsed)).toBe(true);
    });
});
