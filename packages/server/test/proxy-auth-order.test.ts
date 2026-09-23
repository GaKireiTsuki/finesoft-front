import { Hono } from "hono";
import { afterEach, expect, test, vi } from "vite-plus/test";

const hooks = vi.hoisted(() => ({
    fetch: undefined as undefined | ((request: Request) => Promise<Response>),
    setup: undefined as undefined | ((app: any) => void),
    failSetup: false,
}));
vi.mock("../src/dynamic-import", () => ({
    dynamicImport: async (specifier: string) => {
        if (specifier === "hono") return import("hono");
        if (specifier === "@hono/node-server")
            return {
                getRequestListener: (fetch: typeof hooks.fetch) => {
                    hooks.fetch = fetch;
                    return () => {};
                },
            };
        if (specifier === "node:fs") return { readFileSync: () => "<!--ssr-body-->" };
        if (specifier === "node:path") return import("node:path");
        if (specifier === "node:url") return import("node:url");
        if (specifier.endsWith("/setup.mjs")) {
            if (hooks.failSetup) throw new Error("setup unavailable");
            return { default: hooks.setup };
        }
        if (specifier.endsWith("/ssr.js"))
            return {
                render: async () => ({ html: "page", head: "", css: "", serverData: {} }),
                serializeServerData: JSON.stringify,
            };
        throw new Error(`Unexpected import: ${specifier}`);
    },
}));
vi.mock("../src/app", async () => {
    const { Hono } = await import("hono");
    return { createSSRApp: () => Object.assign(new Hono(), { dispose: async () => {} }) };
});
import { finesoftFrontViteConfig } from "../src/vite-plugin";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    hooks.fetch = undefined;
    hooks.failSetup = false;
});

test.each(["dev-function", "dev-module", "preview-function", "preview-module"])(
    "%s runs setup auth before credentialed proxies",
    async (mode) => {
        hooks.setup = (app: Hono) => {
            app.use("*", async (c, next) =>
                c.req.header("x-session") === "allowed" ? next() : c.text("Unauthorized", 401),
            );
        };
        const upstream = vi.fn<typeof fetch>(async () => new Response("private data"));
        vi.stubGlobal("fetch", upstream);
        vi.stubEnv("TEST_PROXY_SECRET", "host-secret");
        const plugin = finesoftFrontViteConfig({
            controllerTypes: false,
            setup: mode.endsWith("module") ? "src/setup.ts" : hooks.setup,
            proxies: [
                {
                    prefix: "/private",
                    target: "https://upstream.example",
                    auth: { type: "bearer", envKey: "TEST_PROXY_SECRET" },
                },
            ],
        });
        plugin.configResolved({ root: "/project", command: "serve", resolve: {}, css: {} });
        const server = {
            close: async () => {},
            httpServer: { close: (callback: () => void) => callback() },
            middlewares: { use: vi.fn() },
            ssrLoadModule: async () => ({ default: hooks.setup }),
        };
        const configure = mode.startsWith("dev")
            ? plugin.configureServer(server)
            : plugin.configurePreviewServer(server);
        await configure?.();
        const denied = await hooks.fetch!(new Request("https://app.test/private/data"));
        expect(denied.status).toBe(401);
        expect(upstream).not.toHaveBeenCalled();
        const allowed = await hooks.fetch!(
            new Request("https://app.test/private/data?key=1", {
                headers: { "x-session": "allowed" },
            }),
        );
        expect(await allowed.text()).toBe("private data");
        expect(upstream).toHaveBeenCalledTimes(1);
        expect(upstream.mock.calls[0][0]).toBe("https://upstream.example/data?key=1");
        expect(upstream.mock.calls[0][1]?.headers).toMatchObject({
            Authorization: "Bearer host-secret",
        });
    },
);

test("preview fails closed when its configured setup cannot load", async () => {
    hooks.failSetup = true;
    const plugin = finesoftFrontViteConfig({
        controllerTypes: false,
        setup: "src/setup.ts",
        proxies: [{ prefix: "/private", target: "https://upstream.example" }],
    });
    plugin.configResolved({ root: "/project", command: "serve", resolve: {}, css: {} });
    const server = { middlewares: { use: vi.fn() }, httpServer: { close: vi.fn() } };
    await expect(plugin.configurePreviewServer(server)()).rejects.toThrow("setup unavailable");
    expect(server.middlewares.use).not.toHaveBeenCalled();
});
