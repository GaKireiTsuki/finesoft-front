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
    vi.unstubAllGlobals();
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

    test("loads and caches generated message loaders exposed as module exports", async () => {
        const specifier = makeDataModule(`
            export async function loadMessages(locale, receivedContext) {
                return {
                    locale,
                    runtime: receivedContext.runtime,
                };
            }
        `);

        vi.stubGlobal("__FINESOFT_I18N_LOADER_SPECIFIER__", specifier);

        await expect(resolveGeneratedMessages("fr-FR", context)).resolves.toEqual({
            locale: "fr-FR",
            runtime: "browser",
        });
        expect(globalThis.__FINESOFT_I18N_LOADER__).toBeTypeOf("function");

        vi.stubGlobal(
            "__FINESOFT_I18N_LOADER_SPECIFIER__",
            makeDataModule(`
            export async function loadMessages() {
                throw new Error("cached loader should be reused");
            }
        `),
        );

        await expect(resolveGeneratedMessages("de-DE", context)).resolves.toEqual({
            locale: "de-DE",
            runtime: "browser",
        });
    });

    test("returns undefined when the generated module does not expose a loader", async () => {
        vi.stubGlobal(
            "__FINESOFT_I18N_LOADER_SPECIFIER__",
            makeDataModule(`export const version = "1.0.0";`),
        );

        await expect(resolveGeneratedMessages("en-US", context)).resolves.toBeUndefined();
        expect(globalThis.__FINESOFT_I18N_LOADER__).toBeUndefined();
    });

    test("returns undefined when importing the generated loader fails", async () => {
        vi.stubGlobal(
            "__FINESOFT_I18N_LOADER_SPECIFIER__",
            makeDataModule(`throw new Error("boom");`),
        );

        await expect(resolveGeneratedMessages("en-US", context)).resolves.toBeUndefined();
        expect(globalThis.__FINESOFT_I18N_LOADER__).toBeUndefined();
    });
});

function makeDataModule(source: string): string {
    return `data:text/javascript,${encodeURIComponent(source)}`;
}
