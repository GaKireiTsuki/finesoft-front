import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { MessagesLoaderContext } from "../../src/i18n/messages";

const { resolveGeneratedMessages } = vi.hoisted(() => ({
    resolveGeneratedMessages: vi.fn(),
}));

vi.mock("../../src/i18n/generated-loader", () => ({
    resolveGeneratedMessages,
}));

import { resolveConfiguredMessages } from "../../src/i18n/messages";

afterEach(() => {
    resolveGeneratedMessages.mockReset();
    vi.restoreAllMocks();
});

const context: MessagesLoaderContext = {
    runtime: "browser",
    fetch: vi.fn(async () => new Response("{}")),
    url: "/products?locale=en-US",
};

describe("messages helpers", () => {
    test("returns undefined when locale or context is missing", async () => {
        await expect(resolveConfiguredMessages({ context })).resolves.toBeUndefined();
        await expect(resolveConfiguredMessages({ locale: "en-US" })).resolves.toBeUndefined();
    });

    test("uses the configured loadMessages function before the generated loader", async () => {
        const loadMessages = vi.fn(async () => ({ hello: "Hello" }));

        await expect(
            resolveConfiguredMessages({
                locale: "en-US",
                context,
                loadMessages,
            }),
        ).resolves.toEqual({ hello: "Hello" });

        expect(loadMessages).toHaveBeenCalledWith("en-US", context);
        expect(resolveGeneratedMessages).not.toHaveBeenCalled();
    });

    test("falls back to the generated loader when no loadMessages is configured", async () => {
        resolveGeneratedMessages.mockResolvedValue({ hello: "Generated" });

        await expect(
            resolveConfiguredMessages({
                locale: "en-US",
                context,
            }),
        ).resolves.toEqual({ hello: "Generated" });

        expect(resolveGeneratedMessages).toHaveBeenCalledWith("en-US", context);
    });
});
