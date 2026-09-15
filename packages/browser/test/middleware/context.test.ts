import { afterEach, test, expect, vi } from "vite-plus/test";
import { Container } from "../../../core/src/index";
import { createBrowserContext } from "../../src/middleware/context";
afterEach(() => {
    vi.unstubAllGlobals();
});
test("creates a browser context from document.cookie and window.location", () => {
    const container = new Container();
    const intent = { id: "article", params: { slug: "intro" } };

    vi.stubGlobal("window", {
        location: {
            origin: "https://example.com",
        },
    });
    vi.stubGlobal("document", {
        cookie: "token=abc; theme=light",
    });

    const ctx = createBrowserContext({
        url: "/articles/intro?ref=nav",
        intent,
        container,
    });

    expect(ctx).toMatchObject({
        url: "/articles/intro?ref=nav",
        path: "/articles/intro",
        params: { slug: "intro" },
        intent,
        isServer: false,
        container,
    });
    expect(ctx.getCookie("theme")).toBe("light");
    expect(ctx.getHeader("x-trace")).toBeUndefined();
});
