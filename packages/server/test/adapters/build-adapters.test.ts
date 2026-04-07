import * as nodePath from "node:path";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

const { buildBundle, copyStaticAssets, generateSSREntry, prerenderRoutes } = vi.hoisted(() => ({
    buildBundle: vi.fn(),
    copyStaticAssets: vi.fn(),
    generateSSREntry: vi.fn(),
    prerenderRoutes: vi.fn(),
}));

vi.mock("../../src/adapters/shared", () => ({
    buildBundle,
    copyStaticAssets,
    generateSSREntry,
    prerenderRoutes,
}));

import { cloudflareAdapter } from "../../src/adapters/cloudflare";
import { netlifyAdapter } from "../../src/adapters/netlify";
import { nodeAdapter } from "../../src/adapters/node";
import { vercelAdapter } from "../../src/adapters/vercel";

afterEach(() => {
    vi.restoreAllMocks();
    buildBundle.mockReset();
    copyStaticAssets.mockReset();
    generateSSREntry.mockReset();
    prerenderRoutes.mockReset();
});

describe("deployment adapters", () => {
    test("builds Node output and writes prerendered pages", async () => {
        const { files, fs } = createFsMock();
        const ctx = createAdapterContext(fs);
        const log = vi.spyOn(console, "log").mockImplementation(() => {});

        generateSSREntry.mockReturnValue("node-entry-source");
        prerenderRoutes.mockResolvedValue([
            { url: "/", html: "<html>home</html>" },
            { url: "/blog", html: "<html>blog</html>" },
        ]);

        await nodeAdapter().build(ctx as never);

        const tempEntry = nodePath.resolve("/project", ".node-entry.tmp.mjs");
        const prerenderDir = nodePath.resolve("/project", "dist/prerender");

        expect(generateSSREntry).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                platformImport: expect.stringContaining("@hono/node-server"),
                platformMiddleware: expect.stringContaining("prerenderDir"),
                platformExport: expect.stringContaining("serve({ fetch: app.fetch, port }"),
            }),
        );
        expect(fs.writeFileSync).toHaveBeenCalledWith(tempEntry, "node-entry-source");
        expect(buildBundle).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                entry: ".node-entry.tmp.mjs",
                outDir: nodePath.resolve("/project", "dist/server"),
                target: "node18",
                emptyOutDir: false,
            }),
        );
        expect(prerenderRoutes).toHaveBeenCalledWith(ctx);
        expect(fs.mkdirSync).toHaveBeenCalledWith(prerenderDir, {
            recursive: true,
        });
        expect(files.get(nodePath.join(prerenderDir, "index.html"))).toBe("<html>home</html>");
        expect(files.get(nodePath.join(prerenderDir, "/blog", "index.html"))).toBe(
            "<html>blog</html>",
        );
        expect(fs.rmSync).toHaveBeenCalledWith(tempEntry, { force: true });
        expect(log).toHaveBeenCalledWith(
            "  Node output → dist/server/index.mjs\n  Run: node dist/server/index.mjs\n",
        );
    });

    test("builds Cloudflare output, copies assets, and writes prerendered pages", async () => {
        const { files, fs } = createFsMock();
        const ctx = createAdapterContext(fs);
        const log = vi.spyOn(console, "log").mockImplementation(() => {});

        generateSSREntry.mockReturnValue("cloudflare-entry-source");
        prerenderRoutes.mockResolvedValue([
            { url: "/", html: "<html>home</html>" },
            { url: "/docs", html: "<html>docs</html>" },
        ]);

        await cloudflareAdapter().build(ctx as never);

        const outputDir = nodePath.resolve("/project", "dist/cloudflare");
        const tempEntry = nodePath.resolve("/project", ".cf-entry.tmp.mjs");
        const assetsDir = nodePath.resolve(outputDir, "assets");

        expect(generateSSREntry).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                platformExport: "export default app;",
                platformCache: expect.stringContaining("caches.default"),
            }),
        );
        expect(fs.rmSync).toHaveBeenCalledWith(outputDir, {
            recursive: true,
            force: true,
        });
        expect(fs.writeFileSync).toHaveBeenCalledWith(tempEntry, "cloudflare-entry-source");
        expect(buildBundle).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                entry: ".cf-entry.tmp.mjs",
                outDir: outputDir,
                target: "es2022",
                fileName: "_worker.js",
            }),
        );
        expect(copyStaticAssets).toHaveBeenCalledWith(ctx, assetsDir);
        expect(files.get(nodePath.join(assetsDir, "index.html"))).toBe("<html>home</html>");
        expect(files.get(nodePath.join(assetsDir, "/docs", "index.html"))).toBe(
            "<html>docs</html>",
        );
        expect(fs.rmSync).toHaveBeenCalledWith(tempEntry, { force: true });
        expect(log).toHaveBeenCalledWith("  Cloudflare output → dist/cloudflare/\n");
    });

    test("builds Netlify output, writes redirects, and writes prerendered pages", async () => {
        const { files, fs } = createFsMock();
        const ctx = createAdapterContext(fs);
        const log = vi.spyOn(console, "log").mockImplementation(() => {});

        generateSSREntry.mockReturnValue("netlify-entry-source");
        prerenderRoutes.mockResolvedValue([
            { url: "/", html: "<html>home</html>" },
            { url: "/pricing", html: "<html>pricing</html>" },
        ]);

        await netlifyAdapter().build(ctx as never);

        const funcDir = nodePath.resolve("/project", ".netlify/functions-internal/ssr");
        const clientDir = nodePath.resolve("/project", "dist/client");
        const tempEntry = nodePath.resolve("/project", ".netlify-entry.tmp.mjs");

        expect(generateSSREntry).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                platformImport: expect.stringContaining("hono/netlify"),
                platformPrerenderResponseHook: expect.stringContaining("Netlify-CDN-Cache-Control"),
            }),
        );
        expect(fs.rmSync).toHaveBeenCalledWith(nodePath.resolve("/project", ".netlify"), {
            recursive: true,
            force: true,
        });
        expect(fs.writeFileSync).toHaveBeenCalledWith(tempEntry, "netlify-entry-source");
        expect(buildBundle).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                entry: ".netlify-entry.tmp.mjs",
                outDir: funcDir,
                target: "node18",
            }),
        );
        expect(files.get(nodePath.resolve(clientDir, "_redirects"))).toBe(
            "/* /.netlify/functions/ssr 200\n",
        );
        expect(files.get(nodePath.join(clientDir, "index.html"))).toBe("<html>home</html>");
        expect(files.get(nodePath.join(clientDir, "/pricing", "index.html"))).toBe(
            "<html>pricing</html>",
        );
        expect(fs.rmSync).toHaveBeenCalledWith(tempEntry, { force: true });
        expect(log).toHaveBeenCalledWith(
            "  Netlify output → .netlify/functions-internal/ssr/\n  Publish dir: dist/client/\n",
        );
    });

    test("builds Vercel output, writes config files, and records prerender overrides", async () => {
        const { files, fs } = createFsMock();
        const ctx = createAdapterContext(fs);
        const log = vi.spyOn(console, "log").mockImplementation(() => {});

        generateSSREntry.mockReturnValue("vercel-entry-source");
        prerenderRoutes.mockResolvedValue([
            { url: "/", html: "<html>home</html>" },
            { url: "/pricing", html: "<html>pricing</html>" },
        ]);

        await vercelAdapter().build(ctx as never);

        const outputDir = nodePath.resolve("/project", ".vercel/output");
        const staticDir = nodePath.resolve(outputDir, "static");
        const funcDir = nodePath.resolve(outputDir, "functions/ssr.func");
        const tempEntry = nodePath.resolve("/project", ".vercel-entry.tmp.mjs");
        const vcConfigPath = nodePath.resolve(funcDir, ".vc-config.json");
        const configPath = nodePath.resolve(outputDir, "config.json");

        expect(generateSSREntry).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                platformImport: expect.stringContaining("@hono/node-server"),
                platformExport: expect.stringContaining("x-now-route-matches"),
            }),
        );
        expect(fs.rmSync).toHaveBeenCalledWith(outputDir, {
            recursive: true,
            force: true,
        });
        expect(fs.writeFileSync).toHaveBeenCalledWith(tempEntry, "vercel-entry-source");
        expect(buildBundle).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                entry: ".vercel-entry.tmp.mjs",
                outDir: funcDir,
                target: "node18",
            }),
        );
        expect(copyStaticAssets).toHaveBeenCalledWith(ctx, staticDir);
        expect(JSON.parse(files.get(vcConfigPath) ?? "{}")).toEqual({
            runtime: "nodejs20.x",
            handler: "index.mjs",
            launcherType: "Nodejs",
        });

        const config = JSON.parse(files.get(configPath) ?? "{}");
        expect(config).toMatchObject({
            version: 3,
            routes: [{ handle: "filesystem" }, { src: "/(.*)", dest: "/ssr" }],
        });
        expect(config.overrides).toEqual({
            "index.html": {
                path: "/",
                contentType: "text/html; charset=utf-8",
            },
            "pricing/index.html": {
                path: "/pricing",
                contentType: "text/html; charset=utf-8",
            },
        });
        expect(files.get(nodePath.join(staticDir, "index.html"))).toBe("<html>home</html>");
        expect(files.get(nodePath.join(staticDir, "/pricing", "index.html"))).toBe(
            "<html>pricing</html>",
        );
        expect(fs.rmSync).toHaveBeenCalledWith(tempEntry, { force: true });
        expect(log).toHaveBeenCalledWith("  Vercel output → .vercel/output/\n");
    });
});

function createAdapterContext(fs: {
    mkdirSync: ReturnType<typeof vi.fn>;
    readFileSync: ReturnType<typeof vi.fn>;
    rmSync: ReturnType<typeof vi.fn>;
    writeFileSync: ReturnType<typeof vi.fn>;
}): Record<string, unknown> {
    return {
        root: "/project",
        ssrEntry: "src/ssr.ts",
        templateHtml: "<html></html>",
        resolvedResolve: {},
        resolvedCss: {},
        renderModes: {},
        proxies: [],
        locales: ["en"],
        defaultLocale: "en-US",
        vite: { build: vi.fn() },
        fs,
        path: {
            resolve: (...parts: string[]) => nodePath.resolve(...parts),
            join: (...parts: string[]) => nodePath.join(...parts),
        },
    };
}

function createFsMock(initialFiles: Record<string, string> = {}): {
    files: Map<string, string>;
    fs: {
        mkdirSync: ReturnType<typeof vi.fn>;
        readFileSync: ReturnType<typeof vi.fn>;
        rmSync: ReturnType<typeof vi.fn>;
        writeFileSync: ReturnType<typeof vi.fn>;
    };
} {
    const files = new Map<string, string>(Object.entries(initialFiles));

    return {
        files,
        fs: {
            mkdirSync: vi.fn(),
            readFileSync: vi.fn((filePath: string) => files.get(filePath) ?? "{}"),
            rmSync: vi.fn((filePath: string) => {
                files.delete(filePath);
            }),
            writeFileSync: vi.fn((filePath: string, content: string) => {
                files.set(filePath, String(content));
            }),
        },
    };
}
