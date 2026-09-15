import { describe, expect, test } from "vite-plus/test";
import { resolveMessages } from "../../src/i18n/messages";
describe("pure message helpers", () => {
    test("returns flat messages as-is", () => {
        expect(resolveMessages({ hello: "Hello", bye: "Bye" }, "en-US")).toEqual({
            hello: "Hello",
            bye: "Bye",
        });
    });

    test("flattens nested locale messages for a specific locale", () => {
        expect(
            resolveMessages(
                {
                    "en-US": {
                        hello: "Hello",
                        cart: {
                            one: "1 item",
                            other: "{count} items",
                        },
                    },
                    "fr-FR": {
                        hello: "Bonjour",
                    },
                },
                "en-US",
            ),
        ).toEqual({
            hello: "Hello",
            "cart.one": "1 item",
            "cart.other": "{count} items",
        });
    });

    test("returns undefined for empty messages or missing locales", () => {
        expect(resolveMessages({}, "en-US")).toBeUndefined();
        expect(
            resolveMessages(
                {
                    "fr-FR": {
                        hello: "Bonjour",
                    },
                },
                "en-US",
            ),
        ).toBeUndefined();
    });
});
