import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { Container } from "../../src/dependencies/container";
import { createBrowserContext, createServerContext } from "../../src/middleware/context";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("middleware context builders", () => {
    test("creates a server context from a request", () => {
        const container = new Container();
        const intent = { id: "article", params: { slug: "intro" } };
        const request = new Request("https://example.com/articles/intro?ref=nav", {
            headers: {
                cookie: "token=abc; theme=dark; malformed",
                "x-trace": "trace-1",
            },
        });

        const ctx = createServerContext({
            url: "/articles/intro?ref=nav",
            intent,
            container,
            request,
        });

        expect(ctx).toMatchObject({
            url: "/articles/intro?ref=nav",
            path: "/articles/intro",
            params: { slug: "intro" },
            intent,
            isServer: true,
            container,
        });
        expect(ctx.getCookie("token")).toBe("abc");
        expect(ctx.getCookie("theme")).toBe("dark");
        expect(ctx.getCookie("missing")).toBeUndefined();
        expect(ctx.getHeader("x-trace")).toBe("trace-1");
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
});
