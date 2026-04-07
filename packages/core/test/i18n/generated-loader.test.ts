import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { resolveGeneratedMessages } from "../../src/i18n/generated-loader";
import type { MessagesLoaderContext } from "../../src/i18n/messages";

const context: MessagesLoaderContext = {
    runtime: "browser",
    fetch: vi.fn(async () => new Response("{}")),
    url: "/products?locale=en-US",
};

afterEach(() => {
    globalThis.__FINESOFT_I18N_LOADER__ = undefined;
    vi.restoreAllMocks();
});

describe("resolveGeneratedMessages", () => {
    test("returns undefined when locale or loader context is missing", async () => {
        await expect(resolveGeneratedMessages(undefined, context)).resolves.toBeUndefined();
        await expect(resolveGeneratedMessages("en-US", undefined)).resolves.toBeUndefined();
    });

    test("uses the global generated loader when it is already available", async () => {
        globalThis.__FINESOFT_I18N_LOADER__ = vi.fn(async (locale, receivedContext) => {
            expect(locale).toBe("en-US");
            expect(receivedContext).toBe(context);
            return { hello: "Hello" };
        });

        await expect(resolveGeneratedMessages("en-US", context)).resolves.toEqual({
            hello: "Hello",
        });
    });

    test("returns undefined when no generated loader is configured", async () => {
        globalThis.__FINESOFT_I18N_LOADER__ = undefined;

        await expect(resolveGeneratedMessages("en-US", context)).resolves.toBeUndefined();
    });
});
