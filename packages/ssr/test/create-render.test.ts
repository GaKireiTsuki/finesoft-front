import { describe, expect, test, vi } from "vite-plus/test";
import type { BasePage, Framework } from "../../core/src/index.ts";

const { ssrRender } = vi.hoisted(() => ({
    ssrRender: vi.fn(),
}));

vi.mock("../src/render", () => ({
    ssrRender,
}));

import { createSSRRender } from "../src/create-render";

describe("createSSRRender", () => {
    test("forwards render configuration to ssrRender", async () => {
        const bootstrap = vi.fn();
        const getErrorPage = vi.fn((status: number, message: string) => ({
            id: `error-${status}`,
            pageType: "error",
            title: message,
        }));
        const renderApp = vi.fn(async () => ({
            html: "<main>ok</main>",
            head: "",
            css: "",
        }));
        const resolveLocale = vi.fn(() => ({ lang: "en-US", dir: "ltr" }));
        const loadMessages = vi.fn();
        const ssrContext = { request: new Request("https://example.com/") };
        const expected = {
            html: "<main>ok</main>",
            head: "",
            css: "",
            serverData: [],
        };
        ssrRender.mockResolvedValue(expected);

        const render = createSSRRender({
            bootstrap,
            getErrorPage,
            renderApp,
            frameworkConfig: { locale: "en-US" },
            resolveLocale,
            loadMessages,
        });

        await expect(render("/home", ssrContext as never)).resolves.toBe(expected);
        expect(ssrRender).toHaveBeenCalledWith({
            url: "/home",
            frameworkConfig: { locale: "en-US" },
            bootstrap,
            getErrorPage,
            renderApp: expect.any(Function),
            ssrContext,
            resolveLocale,
            loadMessages,
        });

        const forwardedRenderApp = ssrRender.mock.calls[0][0].renderApp as (
            page: BasePage,
            framework: Framework,
        ) => Promise<unknown>;

        await expect(
            forwardedRenderApp({ id: "home", pageType: "home", title: "Home" }, {} as Framework),
        ).resolves.toEqual({ html: "<main>ok</main>", head: "", css: "" });
        expect(renderApp).toHaveBeenCalled();
    });

    test("defaults frameworkConfig to an empty object", async () => {
        ssrRender.mockResolvedValue({
            html: "",
            head: "",
            css: "",
            serverData: [],
        });

        const render = createSSRRender({
            bootstrap: vi.fn(),
            getErrorPage: vi.fn(),
            renderApp: vi.fn(),
        });

        await render("/");

        expect(ssrRender).toHaveBeenCalledWith(
            expect.objectContaining({
                frameworkConfig: {},
            }),
        );
    });
});
