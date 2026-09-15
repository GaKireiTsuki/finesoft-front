import { expect, test, vi } from "vite-plus/test";
import { resolveConfiguredMessages } from "../../src/i18n/messages";
const context = { runtime: "browser" as const, fetch: globalThis.fetch, url: "/" };
test("no dictionary means no translator messages", async () => {
    expect(await resolveConfiguredMessages({ locale: "en", context })).toBeUndefined();
    expect(await resolveConfiguredMessages({})).toBeUndefined();
});
test("loader and dictionary belong to this invocation", async () => {
    const loader = vi.fn(async () => ({ hello: "one" }));
    expect(
        await resolveConfiguredMessages({ locale: "en", context, loadMessages: loader }),
    ).toEqual({ hello: "one" });
    expect(loader).toHaveBeenCalledWith("en", context);
    expect(
        await resolveConfiguredMessages({
            locale: "en",
            context,
            loadMessages: () => ({ hello: "two" }),
        }),
    ).toEqual({ hello: "two" });
});
