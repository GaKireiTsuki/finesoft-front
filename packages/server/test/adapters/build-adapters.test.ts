import * as nodePath from "node:path";
import { runInNewContext } from "node:vm";
import { Hono } from "hono";
import { secureFetch } from "@finesoft/core";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("../../src/adapters/shared", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/adapters/shared")>();
    return {
        ...actual,
        copyStaticAssets: vi.fn(),
        generateSSREntry: vi.fn(actual.generateSSREntry),
        prerenderRoutes: vi.fn(),
    };
});

import { cloudflareAdapter } from "../../src/adapters/cloudflare";
import { netlifyAdapter } from "../../src/adapters/netlify";
import { nodeAdapter } from "../../src/adapters/node";
import { vercelAdapter } from "../../src/adapters/vercel";
import { copyStaticAssets, generateSSREntry, prerenderRoutes } from "../../src/adapters/shared";
import type { AdapterContext } from "../../src/adapters/types";

const mockCopyStaticAssets = vi.mocked(copyStaticAssets);
const mockGenerateSSREntry = vi.mocked(generateSSREntry);
const mockPrerenderRoutes = vi.mocked(prerenderRoutes);

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe("deployment adapters", () => {
    test("Cloudflare output rejects arbitrary hostnames and permits only explicitly trusted origins", async () => {
        for (const trustedOrigins of [[], ["https://api.example"]]) {
            const { fs } = createFsMock();
            mockPrerenderRoutes.mockResolvedValue([]);
            await cloudflareAdapter({ trustedOrigins }).build(createAdapterContext(fs));
            const source = mockGenerateSSREntry.mock.results.at(-1)!.value as string;
            const expression = source.match(/safeFetch: (.*),\n/)![1];
            const policy = runInNewContext(`(${expression})`);
            const base = vi.fn<typeof fetch>(async () => new Response("ok"));
            const safe = secureFetch(base, policy);
            await expect(safe("https://untrusted.example/path")).rejects.toMatchObject({
                name: "HostGuardError",
            });
            expect(base).not.toHaveBeenCalled();
            if (trustedOrigins.length) {
                expect(await (await safe("https://api.example/path")).text()).toBe("ok");
                base.mockResolvedValue(
                    new Response(null, {
                        status: 302,
                        headers: { location: "https://untrusted.example" },
                    }),
                );
                await expect(safe("https://api.example/redirect")).rejects.toMatchObject({
                    name: "HostGuardError",
                });
                expect(base).toHaveBeenCalledTimes(2);
            }
            base.mockResolvedValue(new Response("internal"));
            expect(await (await safe("/api/internal")).text()).toBe("internal");
        }
    });
    test.each(["win32", "posix"] as const)(
        "Node prerender middleware contains decoded paths under %s semantics",
        async (platform) => {
            const { fs } = createFsMock();
            mockPrerenderRoutes.mockResolvedValue([]);
            await nodeAdapter().build(createAdapterContext(fs));
            const source = mockGenerateSSREntry.mock.calls.at(-1)![1].platformMiddleware!;
            const paths = nodePath[platform];
            const root = platform === "win32" ? "C:\\site\\dist\\server" : "/site/dist/server";
            const prerender = paths.resolve(root, "../prerender");
            const files = new Map([
                [paths.resolve(prerender, "index.html"), "home"],
                [paths.resolve(prerender, "docs/index.html"), "docs"],
                [paths.resolve(root, "../../secrets/index.html"), "secret-index"],
                [paths.resolve(root, "../../secrets.html"), "secret-html"],
            ]);
            const reads = vi.fn((path: string) => files.get(path));
            const app = new Hono();
            runInNewContext(source.replace("import.meta.url", "'entry'"), {
                ...paths,
                app,
                fileURLToPath: () => paths.join(root, "index.mjs"),
                existsSync: (path: string) => files.has(path),
                readFileSync: reads,
            });
            app.all("*", (c) => c.notFound());
            for (const attack of [
                "/..%5C..%5Csecrets",
                "/%2e%2e%5c%2e%2e%5csecrets",
                "/..%5C..%5Csecrets.html",
            ]) {
                expect((await app.request(`https://app.test${attack}`)).status).toBe(404);
            }
            expect(reads).not.toHaveBeenCalled();
            expect(await (await app.request("https://app.test/")).text()).toBe("home");
            expect(await (await app.request("https://app.test/docs")).text()).toBe("docs");
        },
    );
    test("builds Node output and writes prerendered pages", async () => {
        const { files, fs } = createFsMock();
        const ctx = createAdapterContext(fs);
        const log = vi.spyOn(console, "log").mockImplementation(() => {});

        mockPrerenderRoutes.mockResolvedValue([
            { url: "/", html: "<html>home</html>" },
            { url: "/blog", html: "<html>blog</html>" },
        ]);

        await nodeAdapter().build(ctx);

        const tempEntry = nodePath.resolve("/project", ".node-entry.tmp.mjs");
        const prerenderDir = nodePath.resolve("/project", "dist/prerender");

        expect(mockGenerateSSREntry).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                platformImport: expect.stringContaining("@finesoft/front"),
                platformMiddleware: expect.stringContaining("prerenderDir"),
                platformExport: expect.stringContaining(
                    "startNodeHandler({ handler: { fetch: async request => app.fetch(request) }, port, disposeApp: ssr.dispose }",
                ),
            }),
        );
        expect(fs.writeFileSync).toHaveBeenCalledWith(tempEntry, expect.any(String));
        expect(ctx.vite.build).toHaveBeenCalledWith(
            expect.objectContaining({
                build: expect.objectContaining({
                    ssr: ".node-entry.tmp.mjs",
                    outDir: nodePath.resolve("/project", "dist/server"),
                    target: "node18",
                    emptyOutDir: false,
                }),
            }),
        );
        expect(mockPrerenderRoutes).toHaveBeenCalledWith(ctx);
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

        mockPrerenderRoutes.mockResolvedValue([
            { url: "/", html: "<html>home</html>" },
            { url: "/docs", html: "<html>docs</html>" },
        ]);

        await cloudflareAdapter().build(ctx);

        const outputDir = nodePath.resolve("/project", "dist/cloudflare");
        const tempEntry = nodePath.resolve("/project", ".cf-entry.tmp.mjs");
        const assetsDir = nodePath.resolve(outputDir, "assets");

        expect(mockGenerateSSREntry).toHaveBeenCalledWith(
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
        expect(fs.writeFileSync).toHaveBeenCalledWith(tempEntry, expect.any(String));
        expect(ctx.vite.build).toHaveBeenCalledWith(
            expect.objectContaining({
                build: expect.objectContaining({
                    ssr: ".cf-entry.tmp.mjs",
                    outDir: outputDir,
                    target: "es2022",
                    rollupOptions: { output: { entryFileNames: "_worker.js" } },
                }),
            }),
        );
        expect(mockCopyStaticAssets).toHaveBeenCalledWith(ctx, assetsDir);
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

        mockPrerenderRoutes.mockResolvedValue([
            { url: "/", html: "<html>home</html>" },
            { url: "/pricing", html: "<html>pricing</html>" },
        ]);

        await netlifyAdapter().build(ctx);

        const funcDir = nodePath.resolve("/project", ".netlify/functions-internal/ssr");
        const clientDir = nodePath.resolve("/project", "dist/client");
        const tempEntry = nodePath.resolve("/project", ".netlify-entry.tmp.mjs");

        expect(mockGenerateSSREntry).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                platformImport: expect.stringContaining("hono/netlify"),
                publicCacheHeaders: {
                    "Netlify-CDN-Cache-Control":
                        "public, max-age=3600, stale-while-revalidate=86400",
                },
            }),
        );
        const netlifyOptions = mockGenerateSSREntry.mock.calls[0]?.[1] as {
            platformCache: string;
        };
        const cache = createPlatformCache(netlifyOptions.platformCache);
        for (let index = 0; index < 1000; index++) {
            await cache.platformCacheSet(`/${index}`, String(index));
        }
        expect(await cache.platformCacheGet("/0")).toBe("0");
        await cache.platformCacheSet("/1000", "1000");
        await expect(cache.platformCacheGet("/0")).resolves.toBeNull();
        await expect(cache.platformCacheGet("/1")).resolves.toBe("1");
        expect(fs.rmSync).toHaveBeenCalledWith(nodePath.resolve("/project", ".netlify"), {
            recursive: true,
            force: true,
        });
        expect(fs.writeFileSync).toHaveBeenCalledWith(tempEntry, expect.any(String));
        expect(ctx.vite.build).toHaveBeenCalledWith(
            expect.objectContaining({
                build: expect.objectContaining({
                    ssr: ".netlify-entry.tmp.mjs",
                    outDir: funcDir,
                    target: "node18",
                }),
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

        mockPrerenderRoutes.mockResolvedValue([
            { url: "/", html: "<html>home</html>" },
            { url: "/pricing", html: "<html>pricing</html>" },
        ]);

        await vercelAdapter().build(ctx);

        const outputDir = nodePath.resolve("/project", ".vercel/output");
        const staticDir = nodePath.resolve(outputDir, "static");
        const funcDir = nodePath.resolve(outputDir, "functions/ssr.func");
        const tempEntry = nodePath.resolve("/project", ".vercel-entry.tmp.mjs");
        const vcConfigPath = nodePath.resolve(funcDir, ".vc-config.json");
        const configPath = nodePath.resolve(outputDir, "config.json");

        expect(mockGenerateSSREntry).toHaveBeenCalledWith(
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
        expect(fs.writeFileSync).toHaveBeenCalledWith(tempEntry, expect.any(String));
        expect(ctx.vite.build).toHaveBeenCalledWith(
            expect.objectContaining({
                build: expect.objectContaining({
                    ssr: ".vercel-entry.tmp.mjs",
                    outDir: funcDir,
                    target: "node18",
                }),
            }),
        );
        expect(mockCopyStaticAssets).toHaveBeenCalledWith(ctx, staticDir);
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

interface PlatformCache {
    platformCacheGet(url: string): Promise<string | null>;
    platformCacheSet(url: string, html: string): Promise<void>;
}

function createPlatformCache(source: string): PlatformCache {
    return runInNewContext(`${source}\n({ platformCacheGet, platformCacheSet })`) as PlatformCache;
}

type AdapterTestContext = AdapterContext & {
    vite: { build: ReturnType<typeof vi.fn> };
};

function createAdapterContext(fs: {
    mkdirSync: ReturnType<typeof vi.fn>;
    readFileSync: ReturnType<typeof vi.fn>;
    rmSync: ReturnType<typeof vi.fn>;
    writeFileSync: ReturnType<typeof vi.fn>;
}): AdapterTestContext {
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
    } as unknown as AdapterTestContext;
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
