import { Hono } from "hono";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

const { createSSRApp, detectRuntime, dynamicImport, registerProxyRoutes, startServer } = vi.hoisted(
    () => ({
        createSSRApp: vi.fn(),
        detectRuntime: vi.fn(),
        dynamicImport: vi.fn(),
        registerProxyRoutes: vi.fn(),
        startServer: vi.fn(),
    }),
);

vi.mock("../src/app", () => ({
    createSSRApp,
}));

vi.mock("../src/dynamic-import", () => ({
    dynamicImport,
}));

vi.mock("../src/proxy", () => ({
    registerProxyRoutes,
}));

vi.mock("../src/runtime", () => ({
    detectRuntime,
}));

vi.mock("../src/start", () => ({
    startServer,
}));

import { createServer } from "../src/create-server";

afterEach(() => {
    delete process.env.PORT;
    vi.restoreAllMocks();
    createSSRApp.mockReset();
    detectRuntime.mockReset();
    dynamicImport.mockReset();
    registerProxyRoutes.mockReset();
    startServer.mockReset();
});

describe("createServer", () => {
    test("loads .env, creates dev Vite, registers routes, and starts the server", async () => {
        const existsSync = vi.fn(() => true);
        const dotenvConfig = vi.fn();
        const createViteServer = vi.fn(async () => ({ middlewares: vi.fn() }));
        const runtime = makeRuntime();
        const ssrApp = new Hono();
        const setup = vi.fn();
        const proxies = [{ prefix: "/api", target: "https://example.com" }];

        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "node:fs") {
                return { existsSync };
            }
            if (specifier === "node:path") {
                return {
                    resolve: (...parts: string[]) => parts.join("/"),
                };
            }
            if (specifier === "dotenv") {
                return { config: dotenvConfig };
            }
            if (specifier === "vite") {
                return { createServer: createViteServer };
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });
        detectRuntime.mockReturnValue(runtime);
        createSSRApp.mockReturnValue(ssrApp);
        startServer.mockResolvedValue({
            vite: createViteServer.mock.results[0]?.value,
        });

        const result = await createServer({
            root: "/project",
            port: 1234,
            setup,
            proxies,
            ssr: {
                ssrEntryPath: "/src/ssr.ts",
                ssrProductionModule: "file:///dist/server/ssr.js",
            },
        });

        expect(dotenvConfig).toHaveBeenCalledWith({ path: "/project/.env" });
        expect(createViteServer).toHaveBeenCalledWith({
            root: "/project",
            server: { middlewareMode: true },
            appType: "custom",
        });
        expect(registerProxyRoutes).toHaveBeenCalledWith(expect.any(Hono), proxies);
        expect(setup).toHaveBeenCalledWith(expect.any(Hono));
        expect(createSSRApp).toHaveBeenCalledWith(
            expect.objectContaining({
                root: "/project",
                vite: await createViteServer.mock.results[0].value,
                isProduction: false,
                parentFetch: expect.any(Function),
                ssrEntryPath: "/src/ssr.ts",
                ssrProductionModule: "file:///dist/server/ssr.js",
            }),
        );
        expect(startServer).toHaveBeenCalledWith(
            expect.objectContaining({
                app: expect.any(Hono),
                root: "/project",
                port: 1234,
                isProduction: false,
                vite: await createViteServer.mock.results[0].value,
                runtime,
                ssrEntryPath: "/src/ssr.ts",
            }),
        );
        expect(result.app).toBeInstanceOf(Hono);
        expect(result.vite).toEqual(await createViteServer.mock.results[0].value);
        expect(result.runtime).toBe(runtime);
    });

    test("uses process defaults and skips Vite in production", async () => {
        process.env.PORT = "4567";
        const runtime = makeRuntime({ isProduction: true });
        const ssrApp = new Hono();
        const cwd = vi.spyOn(process, "cwd").mockReturnValue("/workspace");

        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "node:fs") {
                return { existsSync: () => false };
            }
            if (specifier === "node:path") {
                return {
                    resolve: (...parts: string[]) => parts.join("/"),
                };
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });
        detectRuntime.mockReturnValue(runtime);
        createSSRApp.mockReturnValue(ssrApp);
        startServer.mockResolvedValue({});

        const result = await createServer();

        expect(cwd).toHaveBeenCalledTimes(1);
        expect(dynamicImport.mock.calls.map(([specifier]) => specifier)).not.toContain("vite");
        expect(createSSRApp).toHaveBeenCalledWith(
            expect.objectContaining({
                root: "/workspace",
                vite: undefined,
                isProduction: true,
            }),
        );
        expect(startServer).toHaveBeenCalledWith(
            expect.objectContaining({
                root: "/workspace",
                port: 4567,
                vite: undefined,
                runtime,
            }),
        );
        expect(result.vite).toBeUndefined();
        expect(result.runtime).toBe(runtime);
    });

    test("warns when dotenv loading fails and skips dev Vite on Vercel", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const runtime = makeRuntime({ isVercel: true });

        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "node:fs") {
                return { existsSync: () => true };
            }
            if (specifier === "node:path") {
                return {
                    resolve: (...parts: string[]) => parts.join("/"),
                };
            }
            if (specifier === "dotenv") {
                throw new Error("dotenv missing");
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });
        detectRuntime.mockReturnValue(runtime);
        createSSRApp.mockReturnValue(new Hono());
        startServer.mockResolvedValue({});

        await createServer({ root: "/project" });

        expect(warn).toHaveBeenCalledWith("[Server] Failed to load .env: dotenv missing");
        expect(dynamicImport.mock.calls.map(([specifier]) => specifier)).not.toContain("vite");
    });
});

function makeRuntime(overrides: Partial<{ isProduction: boolean; isVercel: boolean }> = {}): {
    isProduction: boolean;
    isVercel: boolean;
} {
    return {
        isProduction: false,
        isVercel: false,
        ...overrides,
    };
}
