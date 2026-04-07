import * as nodePath from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

const { dynamicImport } = vi.hoisted(() => ({
    dynamicImport: vi.fn(),
}));

vi.mock("../../src/dynamic-import", () => ({
    dynamicImport,
}));

import { staticAdapter } from "../../src/adapters/static";

afterEach(() => {
    vi.restoreAllMocks();
    dynamicImport.mockReset();
});

describe("staticAdapter", () => {
    test("builds static output with SSR, CSR overrides, and dynamic routes", async () => {
        const { files, fs } = createFsMock();
        const vite = { build: vi.fn(async () => {}) };
        const copyStaticAssets = vi.fn();
        const render = vi.fn(async (url: string) => ({
            html: `<main>${url}</main>`,
            head: '<meta charset="utf-8">',
            css: ".app{color:red}",
            serverData: [{ url }],
        }));
        const ctx = createStaticContext({
            fs,
            vite,
            copyStaticAssets,
            templateHtml:
                "<html><head><!--ssr-head--></head><body><!--ssr-body--><!--ssr-data--></body></html>",
            renderModes: {
                "/client": "csr",
                "/catalog/*": "prerender",
            },
        });
        const routesModuleUrl = pathToFileURL(
            nodePath.resolve("/project", "dist/server/_routes.mjs"),
        ).href;
        const ssrModuleUrl = pathToFileURL(nodePath.resolve("/project", "dist/server/ssr.js")).href;

        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "node:url") {
                return import("node:url");
            }
            if (specifier === ssrModuleUrl) {
                return {
                    render,
                    serializeServerData: vi.fn((data: unknown) => JSON.stringify(data)),
                };
            }
            if (specifier === routesModuleUrl) {
                return {
                    routes: [
                        { path: "/", renderMode: "prerender" },
                        { path: "/client", renderMode: "ssr" },
                        { path: "/user/:id", renderMode: "prerender" },
                    ],
                };
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });

        await staticAdapter({
            routesExport: "src/routes.ts",
            dynamicRoutes: ["/catalog/game"],
        }).build(ctx as never);

        const outputDir = nodePath.resolve("/project", "dist/static");

        expect(fs.rmSync).toHaveBeenCalledWith(outputDir, {
            recursive: true,
            force: true,
        });
        expect(fs.mkdirSync).toHaveBeenCalledWith(outputDir, {
            recursive: true,
        });
        expect(copyStaticAssets).toHaveBeenCalledWith(outputDir, {
            excludeHtml: true,
        });
        expect(vite.build).toHaveBeenCalledWith({
            root: "/project",
            build: {
                ssr: "src/routes.ts",
                outDir: nodePath.resolve("/project", "dist/server"),
                emptyOutDir: false,
                rollupOptions: {
                    output: { entryFileNames: "_routes.mjs" },
                },
            },
            resolve: {},
        });
        expect(fs.rmSync).toHaveBeenCalledWith(
            nodePath.resolve("/project", "dist/server/_routes.mjs"),
            {
                force: true,
            },
        );
        expect(render).toHaveBeenCalledTimes(2);
        expect(files.get(nodePath.join(outputDir, "index.html"))).toContain("<main>/</main>");
        expect(files.get(nodePath.join(outputDir, "/client", "index.html"))).toContain(
            "<body></body>",
        );
        expect(files.get(nodePath.join(outputDir, "/client", "index.html"))).not.toContain(
            "<main>/client</main>",
        );
        expect(files.get(nodePath.join(outputDir, "/catalog/game", "index.html"))).toContain(
            "<main>/catalog/game</main>",
        );
    });

    test("falls back to prerendering the root route when route extraction fails", async () => {
        const { files, fs } = createFsMock();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const vite = {
            build: vi.fn(async () => {
                throw new Error("routes failed");
            }),
        };
        const copyStaticAssets = vi.fn();
        const render = vi.fn(async () => ({
            html: "<main>/</main>",
            head: "",
            css: "",
            serverData: [],
        }));
        const ctx = createStaticContext({
            fs,
            vite,
            copyStaticAssets,
            templateHtml:
                "<html><head><!--ssr-head--></head><body><!--ssr-body--><!--ssr-data--></body></html>",
        });
        const ssrModuleUrl = pathToFileURL(nodePath.resolve("/project", "dist/server/ssr.js")).href;

        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "node:url") {
                return import("node:url");
            }
            if (specifier === ssrModuleUrl) {
                return {
                    render,
                    serializeServerData: vi.fn((data: unknown) => JSON.stringify(data)),
                };
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });

        await staticAdapter().build(ctx as never);

        const outputDir = nodePath.resolve("/project", "dist/static");

        expect(warn).toHaveBeenCalledWith(
            '  [static] Could not load routes from "src/lib/bootstrap.ts". Using "/" only.',
            expect.any(Error),
        );
        expect(copyStaticAssets).toHaveBeenCalledWith(outputDir, {
            excludeHtml: true,
        });
        expect(render).toHaveBeenCalledWith("/");
        expect(files.get(nodePath.join(outputDir, "index.html"))).toContain("<main>/</main>");
    });
});

function createStaticContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        root: "/project",
        templateHtml: "<html></html>",
        renderModes: {},
        resolvedResolve: {},
        vite: { build: vi.fn(async () => {}) },
        copyStaticAssets: vi.fn(),
        fs: {
            mkdirSync: vi.fn(),
            rmSync: vi.fn(),
            writeFileSync: vi.fn(),
        },
        path: {
            resolve: (...parts: string[]) => nodePath.resolve(...parts),
            join: (...parts: string[]) => nodePath.join(...parts),
        },
        ...overrides,
    };
}

function createFsMock(initialFiles: Record<string, string> = {}): {
    files: Map<string, string>;
    fs: {
        mkdirSync: ReturnType<typeof vi.fn>;
        rmSync: ReturnType<typeof vi.fn>;
        writeFileSync: ReturnType<typeof vi.fn>;
    };
} {
    const files = new Map<string, string>(Object.entries(initialFiles));

    return {
        files,
        fs: {
            mkdirSync: vi.fn(),
            rmSync: vi.fn(),
            writeFileSync: vi.fn((filePath: string, content: string) => {
                files.set(filePath, String(content));
            }),
        },
    };
}
