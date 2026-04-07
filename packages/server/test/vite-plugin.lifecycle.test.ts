import * as nodePath from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

const {
    HonoMock,
    buildBundle,
    copyStaticAssets,
    createInternalFetch,
    createSSRApp,
    dynamicImport,
    generateSSREntry,
    getLocaleAttributes,
    injectCSRShell,
    injectSSRContent,
    registerProxyRoutes,
    resolveAdapter,
} = vi.hoisted(() => {
    class HonoMock {
        static instances: HonoMock[] = [];

        readonly route = vi.fn();
        readonly get = vi.fn((path: string, handler: unknown) => {
            this.handlers.set(`GET ${path}`, handler);
        });
        readonly fetch = vi.fn(async (...args: unknown[]) => ({ args }));
        readonly handlers = new Map<string, unknown>();

        constructor() {
            HonoMock.instances.push(this);
        }

        static latest(): HonoMock {
            const instance = HonoMock.instances.at(-1);
            if (!instance) {
                throw new Error("No HonoMock instance created");
            }
            return instance;
        }

        static reset(): void {
            HonoMock.instances = [];
        }
    }

    return {
        HonoMock,
        buildBundle: vi.fn(),
        copyStaticAssets: vi.fn(),
        createInternalFetch: vi.fn(),
        createSSRApp: vi.fn(),
        dynamicImport: vi.fn(),
        generateSSREntry: vi.fn(),
        getLocaleAttributes: vi.fn(),
        injectCSRShell: vi.fn(),
        injectSSRContent: vi.fn(),
        registerProxyRoutes: vi.fn(),
        resolveAdapter: vi.fn(),
    };
});

vi.mock("@finesoft/core", () => ({
    getLocaleAttributes,
}));

vi.mock("@finesoft/ssr", () => ({
    injectCSRShell,
    injectSSRContent,
}));

vi.mock("../src/adapters/resolve", () => ({
    resolveAdapter,
}));

vi.mock("../src/adapters/shared", () => ({
    NODE_BUILTINS: ["node:fs", "node:path"],
    buildBundle,
    copyStaticAssets,
    generateSSREntry,
}));

vi.mock("../src/app", () => ({
    createSSRApp,
}));

vi.mock("../src/dynamic-import", () => ({
    dynamicImport,
}));

vi.mock("../src/internal-fetch", () => ({
    MAX_SSR_DEPTH: 3,
    SSR_DEPTH_HEADER: "x-ssr-depth",
    createInternalFetch,
}));

vi.mock("../src/proxy", () => ({
    registerProxyRoutes,
}));

import { finesoftFrontViteConfig } from "../src/vite-plugin";

afterEach(() => {
    delete process.env.__FINESOFT_SUB_BUILD__;
    HonoMock.reset();
    vi.restoreAllMocks();
    buildBundle.mockReset();
    copyStaticAssets.mockReset();
    createInternalFetch.mockReset();
    createSSRApp.mockReset();
    dynamicImport.mockReset();
    generateSSREntry.mockReset();
    getLocaleAttributes.mockReset();
    injectCSRShell.mockReset();
    injectSSRContent.mockReset();
    registerProxyRoutes.mockReset();
    resolveAdapter.mockReset();
});

describe("finesoftFrontViteConfig lifecycle", () => {
    test("returns minimal config during sub-builds when i18n is not configured", () => {
        process.env.__FINESOFT_SUB_BUILD__ = "1";
        const plugin = finesoftFrontViteConfig() as VitePluginShape & {
            config(config: Record<string, unknown>): Record<string, unknown>;
        };

        expect(plugin.config({ build: { outDir: "dist/custom" } })).toEqual({
            appType: "custom",
            define: {
                __FINESOFT_I18N_LOADER_SPECIFIER__: "undefined",
            },
        });
    });

    test("uses the caller build outDir and ignores unrelated virtual loader ids", async () => {
        const plugin = finesoftFrontViteConfig({
            i18n: { messagesDir: "src/locales" },
        }) as VitePluginShape & {
            config(config: Record<string, unknown>): Record<string, unknown>;
            resolveId(id: string): string | null;
            load(id: string): Promise<string | null>;
        };

        expect(plugin.config({ build: { outDir: "dist/custom-client" } })).toEqual({
            appType: "custom",
            define: {
                __FINESOFT_I18N_LOADER_SPECIFIER__: '"virtual:finesoft-front/i18n-loader"',
            },
            build: {
                outDir: "dist/custom-client",
            },
        });
        expect(plugin.resolveId("virtual:other-loader")).toBeNull();
        await expect(plugin.load("\0virtual:other-loader")).resolves.toBeNull();
    });

    test("inlines dev CSS dependencies and skips asset requests", async () => {
        const plugin = finesoftFrontViteConfig() as VitePluginShape;
        const baseCss = {
            url: "/src/base.css",
            importedModules: new Set<unknown>(),
        };
        const nestedCss = {
            url: "/src/nested.css",
            importedModules: new Set<unknown>(),
        };
        const brokenCss = {
            url: "/src/broken.css",
            importedModules: new Set<unknown>(),
        };
        const svelteCss = {
            url: "/src/App.svelte.css",
            importedModules: new Set<unknown>(),
        };
        const featureModule = {
            url: "/src/feature.ts",
            importedModules: new Set<unknown>([nestedCss]),
        };
        const browserModule = {
            url: "/src/main.ts",
            importedModules: new Set<unknown>([baseCss, featureModule, brokenCss, svelteCss]),
        };
        const transformRequest = vi.fn(async () => ({}));
        const getModuleByUrl = vi.fn(async () => browserModule);
        const ssrLoadModule = vi.fn(async (url: string) => {
            if (url === "/src/base.css") {
                return { default: "body{color:red}" };
            }
            if (url === "/src/nested.css") {
                return { default: ".page{display:flex}" };
            }
            if (url === "/src/broken.css") {
                throw new Error("compile failed");
            }
            throw new Error(`Unexpected CSS module: ${url}`);
        });
        const server = {
            transformRequest,
            moduleGraph: { getModuleByUrl },
            ssrLoadModule,
        };
        const html = [
            '<script type="module" src="/@vite/client"></script>',
            '<script type="module" src="/src/main.ts"></script>',
        ].join("");

        const tags = await plugin.transformIndexHtml.handler(html, {
            server,
            originalUrl: "/products",
        });
        const skipped = await plugin.transformIndexHtml.handler(html, {
            server,
            originalUrl: "/feed.xml",
        });

        expect(skipped).toBeUndefined();
        expect(transformRequest).toHaveBeenCalledWith("/src/main.ts");
        expect(getModuleByUrl).toHaveBeenCalledWith("/src/main.ts");
        expect(ssrLoadModule).toHaveBeenCalledTimes(3);
        expect(tags).toEqual([
            {
                tag: "style",
                attrs: { "data-vite-dev-id": "/src/base.css" },
                children: "body{color:red}",
                injectTo: "head",
            },
            {
                tag: "style",
                attrs: { "data-vite-dev-id": "/src/nested.css" },
                children: ".page{display:flex}",
                injectTo: "head",
            },
        ]);
    });

    test("returns early from transformIndexHtml when there is nothing useful to inline", async () => {
        const plugin = finesoftFrontViteConfig() as VitePluginShape;
        const noServer = await plugin.transformIndexHtml.handler("<html></html>", {});
        const noAppEntry = await plugin.transformIndexHtml.handler(
            '<script type="module" src="/@vite/client"></script>',
            { server: {} },
        );
        const transformRequest = vi.fn(async () => ({}));
        const getModuleByUrl = vi.fn(async () => ({
            url: "/src/main.ts",
            importedModules: new Set<unknown>([
                { url: "/src/feature.ts", importedModules: new Set<unknown>() },
            ]),
        }));
        const noCss = await plugin.transformIndexHtml.handler(
            '<script type="module" src="/src/main.ts"></script>',
            {
                server: {
                    transformRequest,
                    moduleGraph: { getModuleByUrl },
                    ssrLoadModule: vi.fn(),
                },
                originalUrl: "/page",
            },
        );

        expect(noServer).toBeUndefined();
        expect(noAppEntry).toBeUndefined();
        expect(noCss).toBeUndefined();
    });

    test("returns early when dev CSS dependency discovery cannot transform the browser entry", async () => {
        const plugin = finesoftFrontViteConfig() as VitePluginShape;
        const result = await plugin.transformIndexHtml.handler(
            '<script type="module" src="/src/main.ts"></script>',
            {
                server: {
                    transformRequest: vi.fn(async () => {
                        throw new Error("transform failed");
                    }),
                },
                originalUrl: "/page",
            },
        );

        expect(result).toBeUndefined();
    });

    test("configures the dev server with proxy routes, setup modules, and SSR middleware", async () => {
        const plugin = finesoftFrontViteConfig({
            proxies: [{ prefix: "/api", target: "https://example.com" }],
            setup: "src/setup.ts",
            renderModes: { "/docs": "csr" },
            defaultLocale: "en-US",
            ssr: { entry: "src/entry.ts" },
        }) as VitePluginShape;
        const setupFn = vi.fn(async () => {});
        const server = {
            ssrLoadModule: vi.fn(async () => ({ utility: setupFn })),
            middlewares: { use: vi.fn() },
        };
        const listener = vi.fn();
        const getRequestListener = vi.fn(() => listener);

        plugin.configResolved({
            root: "/project",
            command: "serve",
            resolve: { alias: { "@": "/src" } },
            css: { modules: true },
        });
        createSSRApp.mockReturnValue("ssr-app");
        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "hono") {
                return { Hono: HonoMock };
            }
            if (specifier === "@hono/node-server") {
                return { getRequestListener };
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });

        const configure = plugin.configureServer(server);
        await configure?.();

        const app = HonoMock.latest();
        expect(registerProxyRoutes).toHaveBeenCalledWith(app, [
            { prefix: "/api", target: "https://example.com" },
        ]);
        expect(server.ssrLoadModule).toHaveBeenCalledWith("/src/setup.ts");
        expect(setupFn).toHaveBeenCalledWith(app);
        expect(createSSRApp).toHaveBeenCalledWith(
            expect.objectContaining({
                root: "/project",
                vite: server,
                isProduction: false,
                ssrEntryPath: "/src/entry.ts",
                renderModes: { "/docs": "csr" },
                defaultLocale: "en-US",
                parentFetch: expect.any(Function),
            }),
        );
        expect(app.route).toHaveBeenCalledWith("/", "ssr-app");
        expect(getRequestListener).toHaveBeenCalledWith(app.fetch);

        const middleware = server.middlewares.use.mock.calls[0]?.[0];
        expect(middleware).toBeTypeOf("function");
        middleware?.("req", "res");
        expect(listener).toHaveBeenCalledWith("req", "res");
    });

    test("uses direct setup functions during dev server configuration", async () => {
        const setup = vi.fn(async () => {});
        const plugin = finesoftFrontViteConfig({
            setup,
            ssr: { entry: "src/entry.ts" },
        }) as VitePluginShape;
        const server = {
            ssrLoadModule: vi.fn(),
            middlewares: { use: vi.fn() },
        };
        const listener = vi.fn();
        const getRequestListener = vi.fn(() => listener);

        plugin.configResolved({
            root: "/project",
            command: "serve",
            resolve: {},
            css: {},
        });
        createSSRApp.mockReturnValue("ssr-app");
        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "hono") {
                return { Hono: HonoMock };
            }
            if (specifier === "@hono/node-server") {
                return { getRequestListener };
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });

        const configure = plugin.configureServer(server);
        await configure?.();

        const app = HonoMock.latest();
        expect(setup).toHaveBeenCalledWith(app);
        expect(server.ssrLoadModule).not.toHaveBeenCalled();
    });

    test("prefers default exports when resolving dev setup modules", async () => {
        const defaultSetup = vi.fn(async () => {});
        const namedSetup = vi.fn(async () => {});
        const plugin = finesoftFrontViteConfig({
            setup: "src/setup.ts",
        }) as VitePluginShape;
        const server = {
            ssrLoadModule: vi.fn(async () => ({
                default: defaultSetup,
                setup: namedSetup,
            })),
            middlewares: { use: vi.fn() },
        };
        const getRequestListener = vi.fn(() => vi.fn());

        plugin.configResolved({
            root: "/project",
            command: "serve",
            resolve: {},
            css: {},
        });
        createSSRApp.mockReturnValue("ssr-app");
        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "hono") {
                return { Hono: HonoMock };
            }
            if (specifier === "@hono/node-server") {
                return { getRequestListener };
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });

        const configure = plugin.configureServer(server);
        await configure?.();

        expect(defaultSetup).toHaveBeenCalledTimes(1);
        expect(namedSetup).not.toHaveBeenCalled();
    });

    test("configures preview routing, caches prerendered HTML, and handles failures", async () => {
        const plugin = finesoftFrontViteConfig({
            setup: "src/setup.ts",
            renderModes: { "/forced-csr": "csr" },
            defaultLocale: "en-US",
        }) as VitePluginShape;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const middlewares = { use: vi.fn() };
        const server = { middlewares };
        const listener = vi.fn();
        const getRequestListener = vi.fn(() => listener);
        const readFileSync = vi.fn(
            () =>
                "<html><head><!--ssr-head--></head><body><!--ssr-body--><!--ssr-data--></body></html>",
        );
        const serializeServerData = vi.fn((data: unknown) => JSON.stringify(data));
        const render = vi.fn(async (url: string) => {
            if (url === "/explode") {
                throw new Error("preview failed");
            }
            if (url === "/route-csr") {
                return {
                    html: `<main>${url}</main>`,
                    head: "",
                    css: "",
                    serverData: [],
                    renderMode: "csr",
                    locale: { lang: "de-DE", dir: "ltr" },
                };
            }

            return {
                html: `<main>${url}</main>`,
                head: '<meta charset="utf-8">',
                css: ".app{color:red}",
                serverData: [{ url }],
                renderMode: "prerender",
                locale: { lang: "fr-FR", dir: "ltr" },
            };
        });
        const internalFetch = vi.fn();
        const setupModuleUrl = pathToFileURL(
            nodePath.resolve("/project", "dist/server/setup.mjs"),
        ).href;
        const ssrModuleUrl = pathToFileURL(nodePath.resolve("/project", "dist/server/ssr.js")).href;

        plugin.configResolved({
            root: "/project",
            command: "serve",
            resolve: {},
            css: {},
        });
        createInternalFetch.mockReturnValue(internalFetch);
        getLocaleAttributes.mockImplementation((locale: string) => ({
            lang: locale,
            dir: "ltr",
        }));
        injectCSRShell.mockImplementation(
            (_template: string, locale?: { lang?: string }) => `CSR:${locale?.lang ?? "none"}`,
        );
        injectSSRContent.mockImplementation(
            ({
                html,
                serializedData,
                locale,
            }: {
                html: string;
                serializedData: string;
                locale?: { lang?: string };
            }) => `SSR:${html}:${serializedData}:${locale?.lang ?? "none"}`,
        );
        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "node:fs") {
                return { readFileSync };
            }
            if (specifier === "node:path") {
                return import("node:path");
            }
            if (specifier === "node:url") {
                return import("node:url");
            }
            if (specifier === "hono") {
                return { Hono: HonoMock };
            }
            if (specifier === "@hono/node-server") {
                return { getRequestListener };
            }
            if (specifier === setupModuleUrl) {
                throw new Error("missing setup module");
            }
            if (specifier === ssrModuleUrl) {
                return { render, serializeServerData };
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });

        const configure = plugin.configurePreviewServer(server);
        await configure?.();

        expect(warn).toHaveBeenCalledWith(
            "[finesoft] Could not load setup module for preview. API routes disabled.",
        );

        const app = HonoMock.latest();
        const handler = app.handlers.get("GET *") as
            | ((context: PreviewContext) => Promise<unknown>)
            | undefined;
        if (!handler) {
            throw new Error("Preview GET handler was not registered");
        }

        const recursionResponse = await handler(
            makePreviewContext("/deep", {
                headers: { "x-ssr-depth": "3" },
            }),
        );
        const forcedCsrResponse = await handler(makePreviewContext("/forced-csr"));
        const prerenderFirst = await handler(makePreviewContext("/cached"));
        const prerenderSecond = await handler(makePreviewContext("/cached"));
        const routeCsrResponse = await handler(makePreviewContext("/route-csr"));
        const explodeResponse = await handler(makePreviewContext("/explode"));

        expect(recursionResponse).toEqual({
            kind: "text",
            text: "SSR recursion loop detected",
            status: 508,
        });
        expect(forcedCsrResponse).toEqual({ kind: "html", html: "CSR:en-US" });
        expect(prerenderFirst).toEqual({
            kind: "html",
            html: 'SSR:<main>/cached</main>:[{"url":"/cached"}]:fr-FR',
        });
        expect(prerenderSecond).toEqual(prerenderFirst);
        expect(routeCsrResponse).toEqual({ kind: "html", html: "CSR:de-DE" });
        expect(explodeResponse).toEqual({
            kind: "text",
            text: "Internal Server Error",
            status: 500,
        });
        expect(render).toHaveBeenCalledTimes(3);
        expect(render).toHaveBeenNthCalledWith(
            1,
            "/cached",
            expect.objectContaining({ fetch: internalFetch }),
        );
        expect(createInternalFetch).toHaveBeenCalledWith(expect.any(Function), 1);
        expect(serializeServerData).toHaveBeenCalledWith([{ url: "/cached" }]);
        expect(error).toHaveBeenCalledWith("[SSR Preview Error]", expect.any(Error));

        const middleware = middlewares.use.mock.calls[0]?.[0];
        expect(middleware).toBeTypeOf("function");
        middleware?.("req", "res");
        expect(listener).toHaveBeenCalledWith("req", "res");
    });

    test("applies glob renderMode overrides during preview routing", async () => {
        const plugin = finesoftFrontViteConfig({
            renderModes: { "/docs/*": "csr" },
            defaultLocale: "ja-JP",
        }) as VitePluginShape;
        const server = { middlewares: { use: vi.fn() } };
        const getRequestListener = vi.fn(() => vi.fn());
        const render = vi.fn(async (url: string) => ({
            html: `<main>${url}</main>`,
            head: "",
            css: "",
            serverData: [],
            renderMode: "prerender",
            locale: undefined,
        }));
        const ssrModuleUrl = pathToFileURL(nodePath.resolve("/project", "dist/server/ssr.js")).href;

        plugin.configResolved({
            root: "/project",
            command: "serve",
            resolve: {},
            css: {},
        });
        getLocaleAttributes.mockImplementation((locale: string) => ({
            lang: locale,
            dir: "ltr",
        }));
        injectCSRShell.mockImplementation(
            (_template: string, locale?: { lang?: string }) => `CSR:${locale?.lang ?? "none"}`,
        );
        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "node:fs") {
                return { readFileSync: () => "<html></html>" };
            }
            if (specifier === "node:path") {
                return import("node:path");
            }
            if (specifier === "node:url") {
                return import("node:url");
            }
            if (specifier === "hono") {
                return { Hono: HonoMock };
            }
            if (specifier === "@hono/node-server") {
                return { getRequestListener };
            }
            if (specifier === ssrModuleUrl) {
                return { render, serializeServerData: () => "[]" };
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });

        const configure = plugin.configurePreviewServer(server);
        await configure?.();

        const app = HonoMock.latest();
        const handler = app.handlers.get("GET *") as
            | ((context: PreviewContext) => Promise<unknown>)
            | undefined;
        if (!handler) {
            throw new Error("Preview GET handler was not registered");
        }

        const response = await handler(makePreviewContext("/docs/getting-started"));

        expect(response).toEqual({ kind: "html", html: "CSR:ja-JP" });
        expect(render).not.toHaveBeenCalled();
    });

    test("runs preview setup and evicts old ISR entries when the cache overflows", async () => {
        const setup = vi.fn(async () => {});
        const plugin = finesoftFrontViteConfig({
            setup,
            proxies: [{ prefix: "/api", target: "https://example.com" }],
        }) as VitePluginShape;
        const server = { middlewares: { use: vi.fn() } };
        const getRequestListener = vi.fn(() => vi.fn());
        const render = vi.fn(async (url: string) => ({
            html: `<main>${url}</main>`,
            head: "",
            css: "",
            serverData: [],
            renderMode: "prerender",
            locale: undefined,
        }));
        const serializeServerData = vi.fn(() => "[]");
        const ssrModuleUrl = pathToFileURL(nodePath.resolve("/project", "dist/server/ssr.js")).href;

        plugin.configResolved({
            root: "/project",
            command: "serve",
            resolve: {},
            css: {},
        });
        injectSSRContent.mockImplementation(({ html }: { html: string }) => `SSR:${html}`);
        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "node:fs") {
                return { readFileSync: () => "<html></html>" };
            }
            if (specifier === "node:path") {
                return import("node:path");
            }
            if (specifier === "node:url") {
                return import("node:url");
            }
            if (specifier === "hono") {
                return { Hono: HonoMock };
            }
            if (specifier === "@hono/node-server") {
                return { getRequestListener };
            }
            if (specifier === ssrModuleUrl) {
                return { render, serializeServerData };
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });

        const configure = plugin.configurePreviewServer(server);
        await configure?.();

        const app = HonoMock.latest();
        expect(registerProxyRoutes).toHaveBeenCalledWith(app, [
            { prefix: "/api", target: "https://example.com" },
        ]);
        expect(setup).toHaveBeenCalledWith(app);

        const handler = app.handlers.get("GET *") as
            | ((context: PreviewContext) => Promise<unknown>)
            | undefined;
        if (!handler) {
            throw new Error("Preview GET handler was not registered");
        }

        for (let index = 0; index <= 1000; index += 1) {
            await handler(makePreviewContext(`/page-${index}`));
        }

        await handler(makePreviewContext("/page-0"));

        expect(render).toHaveBeenCalledTimes(1002);
    });

    test("uses named setup exports when preview setup modules load successfully", async () => {
        const setup = vi.fn(async () => {});
        const plugin = finesoftFrontViteConfig({
            setup: "src/setup.ts",
        }) as VitePluginShape;
        const server = { middlewares: { use: vi.fn() } };
        const getRequestListener = vi.fn(() => vi.fn());
        const setupModuleUrl = pathToFileURL(
            nodePath.resolve("/project", "dist/server/setup.mjs"),
        ).href;
        const ssrModuleUrl = pathToFileURL(nodePath.resolve("/project", "dist/server/ssr.js")).href;

        plugin.configResolved({
            root: "/project",
            command: "serve",
            resolve: {},
            css: {},
        });
        injectSSRContent.mockImplementation(({ html }: { html: string }) => `SSR:${html}`);
        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "node:fs") {
                return { readFileSync: () => "<html></html>" };
            }
            if (specifier === "node:path") {
                return import("node:path");
            }
            if (specifier === "node:url") {
                return import("node:url");
            }
            if (specifier === "hono") {
                return { Hono: HonoMock };
            }
            if (specifier === "@hono/node-server") {
                return { getRequestListener };
            }
            if (specifier === setupModuleUrl) {
                return { setup };
            }
            if (specifier === ssrModuleUrl) {
                return {
                    render: async (url: string) => ({
                        html: `<main>${url}</main>`,
                        head: "",
                        css: "",
                        serverData: [],
                        renderMode: "prerender",
                        locale: undefined,
                    }),
                    serializeServerData: () => "[]",
                };
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });

        const configure = plugin.configurePreviewServer(server);
        await configure?.();

        expect(setup).toHaveBeenCalledTimes(1);
    });

    test("rejects generated i18n loaders that escape the project root", async () => {
        const plugin = finesoftFrontViteConfig({
            i18n: { messagesDir: "/outside/messages" },
        }) as VitePluginShape & {
            load(id: string): Promise<string | null>;
        };

        plugin.configResolved({
            root: "/project",
            command: "serve",
            resolve: {},
            css: {},
        });
        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "node:fs") {
                return { existsSync: () => true };
            }
            if (specifier === "node:path") {
                return import("node:path");
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });

        await expect(plugin.load("\0virtual:finesoft-front/i18n-loader")).rejects.toThrow(
            "[finesoftFrontViteConfig] i18n.messagesDir must stay inside the project root: /outside/messages",
        );
    });

    test("rejects generated i18n loaders when the messages directory does not exist", async () => {
        const plugin = finesoftFrontViteConfig({
            i18n: { messagesDir: "src/missing-locales" },
        }) as VitePluginShape & {
            load(id: string): Promise<string | null>;
        };

        plugin.configResolved({
            root: "/project",
            command: "serve",
            resolve: {},
            css: {},
        });
        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "node:fs") {
                return { existsSync: () => false };
            }
            if (specifier === "node:path") {
                return import("node:path");
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });

        await expect(plugin.load("\0virtual:finesoft-front/i18n-loader")).rejects.toThrow(
            "[finesoftFrontViteConfig] i18n.messagesDir not found: src/missing-locales",
        );
    });

    test("builds SSR/setup bundles and runs the resolved adapter on closeBundle", async () => {
        const plugin = finesoftFrontViteConfig({
            adapter: "node",
            setup: "src/setup.ts",
            bootstrapEntry: "src/bootstrap.ts",
            proxies: [{ prefix: "/api", target: "https://example.com" }],
            renderModes: { "/": "prerender" },
            locales: ["en-US"],
            defaultLocale: "en-US",
            ssr: { entry: "src/custom-ssr.ts" },
        }) as VitePluginShape;
        const vite = { build: vi.fn(async () => {}) };
        const fs = { readFileSync: vi.fn(() => "<html>client</html>") };
        const adapterBuild = vi.fn(async (ctx: AdapterBuildContext) => {
            expect(ctx.root).toBe("/project");
            expect(ctx.ssrEntry).toBe("src/custom-ssr.ts");
            expect(ctx.setupPath).toBe("src/setup.ts");
            expect(ctx.bootstrapEntry).toBe("src/bootstrap.ts");
            expect(ctx.templateHtml).toBe("<html>client</html>");
            expect(ctx.renderModes).toEqual({ "/": "prerender" });
            expect(ctx.proxies).toEqual([{ prefix: "/api", target: "https://example.com" }]);
            expect(ctx.locales).toEqual(["en-US"]);
            expect(ctx.defaultLocale).toBe("en-US");

            ctx.generateSSREntry({ mode: "adapter" });
            ctx.buildBundle({ mode: "bundle" });
            ctx.copyStaticAssets("/deploy", { excludeHtml: true });
        });

        plugin.configResolved({
            root: "/project",
            command: "build",
            resolve: { alias: { "@": "/src" } },
            css: { modules: true },
        });
        resolveAdapter.mockReturnValue({ name: "node", build: adapterBuild });
        generateSSREntry.mockReturnValue("generated-entry");
        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "vite") {
                return vite;
            }
            if (specifier === "node:fs") {
                return fs;
            }
            if (specifier === "node:path") {
                return import("node:path");
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });

        await plugin.closeBundle();

        expect(vite.build).toHaveBeenNthCalledWith(1, {
            root: "/project",
            build: {
                ssr: "src/custom-ssr.ts",
                outDir: "dist/server",
            },
            ssr: {
                external: ["node:fs", "node:path"],
            },
            resolve: { alias: { "@": "/src" } },
            css: { modules: true },
        });
        expect(vite.build).toHaveBeenNthCalledWith(2, {
            root: "/project",
            build: {
                ssr: "src/setup.ts",
                outDir: "dist/server",
                emptyOutDir: false,
                rollupOptions: {
                    output: { entryFileNames: "setup.mjs" },
                },
            },
            resolve: { alias: { "@": "/src" } },
        });
        expect(resolveAdapter).toHaveBeenCalledWith("node");
        expect(fs.readFileSync).toHaveBeenCalledWith(
            nodePath.resolve("/project", "dist/client/index.html"),
            "utf-8",
        );
        expect(adapterBuild).toHaveBeenCalledTimes(1);
        expect(generateSSREntry).toHaveBeenCalledWith(
            expect.objectContaining({ root: "/project" }),
            {
                mode: "adapter",
            },
        );
        expect(buildBundle).toHaveBeenCalledWith(expect.objectContaining({ root: "/project" }), {
            mode: "bundle",
        });
        expect(copyStaticAssets).toHaveBeenCalledWith(
            expect.objectContaining({ root: "/project" }),
            "/deploy",
            { excludeHtml: true },
        );
        expect(process.env.__FINESOFT_SUB_BUILD__).toBeUndefined();
    });
});

interface VitePluginShape {
    configResolved(config: Record<string, unknown>): void;
    configurePreviewServer(server: Record<string, unknown>): (() => Promise<void>) | undefined;
    configureServer(server: Record<string, unknown>): (() => Promise<void>) | undefined;
    closeBundle(): Promise<void>;
    transformIndexHtml: {
        handler(html: string, ctx: Record<string, unknown>): Promise<unknown>;
    };
}

interface PreviewContext {
    req: {
        path: string;
        url: string;
        header(name: string): string | undefined;
    };
    html(value: string): { kind: "html"; html: string };
    text(value: string, status: number): { kind: "text"; text: string; status: number };
}

interface AdapterBuildContext {
    root: string;
    ssrEntry: string;
    setupPath?: string;
    bootstrapEntry?: string;
    templateHtml: string;
    renderModes?: Record<string, string>;
    proxies?: Array<{ prefix: string; target: string }>;
    locales?: string[];
    defaultLocale?: string;
    generateSSREntry(options: Record<string, unknown>): unknown;
    buildBundle(options: Record<string, unknown>): unknown;
    copyStaticAssets(destDir: string, options?: Record<string, unknown>): unknown;
}

function makePreviewContext(
    path: string,
    options: { headers?: Record<string, string>; url?: string } = {},
): PreviewContext {
    const headers = options.headers ?? {};
    return {
        req: {
            path,
            url: options.url ?? `https://app.example${path}`,
            header(name: string) {
                return headers[name];
            },
        },
        html(value: string) {
            return { kind: "html", html: value };
        },
        text(value: string, status: number) {
            return { kind: "text", text: value, status };
        },
    };
}
