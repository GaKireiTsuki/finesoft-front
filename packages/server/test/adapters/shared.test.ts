import * as nodePath from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

const { dynamicImport } = vi.hoisted(() => ({
    dynamicImport: vi.fn(),
}));

vi.mock("../../src/dynamic-import", () => ({
    dynamicImport,
}));

import {
    NODE_BUILTINS,
    buildBundle,
    copyStaticAssets,
    generateSSREntry,
    prerenderRoutes,
} from "../../src/adapters/shared";

afterEach(() => {
    vi.restoreAllMocks();
    dynamicImport.mockReset();
});

describe("shared adapter helpers", () => {
    test("generates SSR entries with platform hooks, setup imports, and proxy code", () => {
        const ctx = createAdapterContext({
            renderModes: { "/docs": "prerender" },
            defaultLocale: "en-US",
            proxies: [{ prefix: "/api", target: "https://example.com" }],
            setupPath: "setup.mjs",
        });

        const code = generateSSREntry(ctx as never, {
            platformImport: 'import { serve } from "@hono/node-server";',
            platformExport: "export default app;",
            platformCache: `async function platformCacheGet(url) { return null; }\nasync function platformCacheSet(url, html) { return html; }`,
            platformMiddleware: `app.use("*", async (_c, next) => next());`,
            platformPrerenderResponseHook: `c.header("x-test", "1");`,
        });

        expect(code).toContain('import _setupDefault from "./setup.mjs";');
        expect(code).toContain('import { render, serializeServerData } from "./ssr.mjs";');
        expect(code).toContain('const RENDER_MODES = {"/docs":"prerender"};');
        expect(code).toContain('const DEFAULT_LOCALE = "en-US";');
        expect(code).toContain('app.all("/api/*"');
        expect(code).toContain("platformCacheGet(url)");
        expect(code).toContain('c.header("x-test", "1");');
        expect(code).toContain("export default app;");
    });

    test("builds bundles and copies static assets with the expected defaults", async () => {
        const fs = {
            cpSync: vi.fn(),
            rmSync: vi.fn(),
        };
        const vite = { build: vi.fn(async () => {}) };
        const ctx = createAdapterContext({
            fs,
            vite,
            resolvedResolve: { alias: { "@": "/src" } },
            resolvedCss: { modules: true },
        });

        await buildBundle(ctx as never, {
            entry: "src/entry.ts",
            outDir: "/project/dist/server",
            target: "node20",
            fileName: "entry.mjs",
            noExternal: false,
            emptyOutDir: false,
        });

        expect(vite.build).toHaveBeenCalledWith({
            root: "/project",
            build: {
                ssr: "src/entry.ts",
                outDir: "/project/dist/server",
                emptyOutDir: false,
                target: "node20",
                rollupOptions: {
                    output: { entryFileNames: "entry.mjs" },
                },
            },
            ssr: {
                noExternal: false,
                external: expect.arrayContaining(["vite", "esbuild", ...NODE_BUILTINS]),
            },
            resolve: { alias: { "@": "/src" } },
            css: { modules: true },
        });

        copyStaticAssets(ctx as never, "/project/out");
        copyStaticAssets(ctx as never, "/project/out-no-html", {
            excludeHtml: false,
        });

        expect(fs.cpSync).toHaveBeenNthCalledWith(1, "/project/dist/client", "/project/out", {
            recursive: true,
        });
        expect(fs.rmSync).toHaveBeenCalledWith("/project/out/index.html", {
            force: true,
        });
        expect(fs.cpSync).toHaveBeenNthCalledWith(
            2,
            "/project/dist/client",
            "/project/out-no-html",
            { recursive: true },
        );
        expect(fs.rmSync).not.toHaveBeenCalledWith("/project/out-no-html/index.html", {
            force: true,
        });
    });

    test("pre-renders static routes, expands locales, and injects locale attributes", async () => {
        const fs = {
            existsSync: vi.fn(() => true),
            rmSync: vi.fn(),
        };
        const vite = { build: vi.fn(async () => {}) };
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        const ctx = createAdapterContext({
            fs,
            vite,
            bootstrapEntry: "src/bootstrap.ts",
            templateHtml:
                "<html><head><!--ssr-head--></head><body><!--ssr-body--><!--ssr-data--></body></html>",
            locales: ["fr"],
            renderModes: { "/blog": "prerender" },
        });
        const routesModuleUrl = pathToFileURL(
            nodePath.resolve("/project", "dist/server/_routes_prerender.mjs"),
        ).href;
        const ssrModuleUrl = pathToFileURL(nodePath.resolve("/project", "dist/server/ssr.js")).href;

        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "node:url") {
                return import("node:url");
            }
            if (specifier === routesModuleUrl) {
                return {
                    routes: [
                        { path: "/", renderMode: "prerender" },
                        { path: "/blog", renderMode: "prerender" },
                        { path: "/product/:id", renderMode: "prerender" },
                    ],
                };
            }
            if (specifier === ssrModuleUrl) {
                return {
                    render: vi.fn(async (url: string) => {
                        if (url === "/fr/blog") {
                            throw new Error("boom");
                        }

                        return {
                            html: `<main>${url}</main>`,
                            head: '<meta charset="utf-8">',
                            css: ".app{color:red}",
                            serverData: [{ url }],
                            locale: url === "/fr" ? "fr-FR" : undefined,
                        };
                    }),
                    serializeServerData: vi.fn((data: unknown) => JSON.stringify(data)),
                };
            }
            if (specifier === "@finesoft/core") {
                return {
                    getLocaleAttributes: (locale: string) => ({
                        lang: locale,
                        dir: "ltr",
                    }),
                };
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });

        const results = await prerenderRoutes(ctx as never);

        expect(vite.build).toHaveBeenCalledWith({
            root: "/project",
            build: {
                ssr: "src/bootstrap.ts",
                outDir: nodePath.resolve("/project", "dist/server"),
                emptyOutDir: false,
                rollupOptions: {
                    output: { entryFileNames: "_routes_prerender.mjs" },
                },
            },
            resolve: {},
        });
        expect(fs.rmSync).toHaveBeenCalledWith(
            nodePath.resolve("/project", "dist/server/_routes_prerender.mjs"),
            { force: true },
        );
        expect(results).toHaveLength(3);
        expect(results.map((result) => result.url)).toEqual(
            expect.arrayContaining(["/", "/blog", "/fr"]),
        );
        expect(results.find((result) => result.url === "/fr")?.html).toContain(
            '<html lang="fr-FR" dir="ltr">',
        );
        expect(results.find((result) => result.url === "/blog")?.html).toContain(
            '<script id="serialized-server-data" type="application/json">',
        );
        expect(warn).toHaveBeenCalledWith(
            "  [prerender] Failed to render /fr/blog:",
            expect.any(Error),
        );
        expect(log).toHaveBeenCalledWith("  Pre-rendered 3 pages (4 routes)\n");
    });

    test("returns early when no prerender routes are discovered", async () => {
        const fs = {
            existsSync: vi.fn(() => false),
            rmSync: vi.fn(),
        };
        const vite = { build: vi.fn(async () => {}) };
        const ctx = createAdapterContext({
            fs,
            vite,
            renderModes: undefined,
            locales: undefined,
        });

        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "node:url") {
                return import("node:url");
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });

        const results = await prerenderRoutes(ctx as never);

        expect(results).toEqual([]);
        expect(vite.build).not.toHaveBeenCalled();
        expect(dynamicImport).toHaveBeenCalledTimes(1);
        expect(dynamicImport).toHaveBeenCalledWith("node:url");
    });
});

function createAdapterContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        root: "/project",
        ssrEntry: "ssr.mjs",
        setupPath: undefined,
        bootstrapEntry: "src/lib/bootstrap.ts",
        templateHtml: "<html></html>",
        resolvedResolve: {},
        resolvedCss: {},
        renderModes: {},
        proxies: [],
        locales: [],
        defaultLocale: undefined,
        vite: { build: vi.fn(async () => {}) },
        fs: {
            cpSync: vi.fn(),
            existsSync: vi.fn(() => false),
            rmSync: vi.fn(),
        },
        path: {
            resolve: (...parts: string[]) => nodePath.resolve(...parts),
            join: (...parts: string[]) => nodePath.join(...parts),
        },
        ...overrides,
    };
}
