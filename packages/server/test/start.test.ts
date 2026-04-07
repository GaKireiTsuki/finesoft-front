import { Hono } from "hono";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

const { detectRuntime, dynamicImport } = vi.hoisted(() => ({
    detectRuntime: vi.fn(),
    dynamicImport: vi.fn(),
}));

vi.mock("../src/dynamic-import", () => ({
    dynamicImport,
}));

vi.mock("../src/runtime", () => ({
    detectRuntime,
}));

import { startServer } from "../src/start";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    detectRuntime.mockReset();
    dynamicImport.mockReset();
});

describe("startServer", () => {
    test("returns immediately for Vercel runtimes", async () => {
        const app = new Hono();
        const vite = { id: "vite" };

        const result = await startServer({
            app,
            root: "/project",
            isProduction: false,
            vite: vite as never,
            runtime: makeRuntime({ isVercel: true }),
        });

        expect(result).toEqual({ vite });
        expect(dynamicImport).not.toHaveBeenCalled();
    });

    test("creates a dev Vite server when missing and prints a startup banner", async () => {
        const app = new Hono();
        const listener = vi.fn();
        const middlewares = vi.fn((_req: unknown, _res: unknown, next: () => void) => next());
        const vite = { middlewares };
        const createViteServer = vi.fn(async () => vite);
        const getRequestListener = vi.fn(() => listener);
        const listen = vi.fn((port: number, callback: () => void) => {
            expect(port).toBe(4321);
            callback();
        });
        const createServer = vi.fn((handler: (req: unknown, res: unknown) => void) => {
            handler("req", "res");
            return { listen };
        });
        const log = vi.spyOn(console, "log").mockImplementation(() => {});

        detectRuntime.mockReturnValue(makeRuntime());
        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "vite") {
                return { createServer: createViteServer };
            }
            if (specifier === "@hono/node-server") {
                return { getRequestListener };
            }
            if (specifier === "node:http") {
                return { createServer };
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });

        const result = await startServer({
            app,
            root: "/project",
            port: 4321,
            isProduction: false,
            routes: ["/ → home"],
            ssrEntryPath: "/src/ssr.ts",
        });

        expect(result).toEqual({ vite });
        expect(detectRuntime).toHaveBeenCalledTimes(1);
        expect(createViteServer).toHaveBeenCalledWith({
            root: "/project",
            server: { middlewareMode: true },
            appType: "custom",
        });
        expect(getRequestListener).toHaveBeenCalledWith(app.fetch);
        expect(middlewares).toHaveBeenCalledWith("req", "res", expect.any(Function));
        expect(listener).toHaveBeenCalledWith("req", "res");
        expect(log).toHaveBeenCalledWith(
            expect.stringContaining("Server running at http://localhost:4321"),
        );
        expect(log).toHaveBeenCalledWith(expect.stringContaining("Routes:"));
        expect(log).toHaveBeenCalledWith(expect.stringContaining("SSR Entry: /src/ssr.ts"));
    });

    test("serves production Node builds with static middleware", async () => {
        const app = new Hono();
        const serveStaticMiddleware = vi.fn(async (_c: unknown, next: () => Promise<void>) => {
            await next();
        });
        let serveStaticConfig:
            | {
                  root: string;
                  rewriteRequestPath: (path: string) => string;
              }
            | undefined;
        const serveStatic = vi.fn(
            (config: { root: string; rewriteRequestPath: (path: string) => string }) => {
                serveStaticConfig = config;
                return serveStaticMiddleware;
            },
        );
        const serve = vi.fn(
            (
                options: { fetch: typeof app.fetch; port: number },
                callback: (info: { port: number }) => void,
            ) => {
                callback({ port: options.port });
            },
        );
        const log = vi.spyOn(console, "log").mockImplementation(() => {});

        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "@hono/node-server/serve-static") {
                return { serveStatic };
            }
            if (specifier === "node:path") {
                return import("node:path");
            }
            if (specifier === "@hono/node-server") {
                return { serve };
            }
            throw new Error(`Unexpected import: ${specifier}`);
        });

        await startServer({
            app,
            root: "/project",
            port: 3001,
            isProduction: true,
            runtime: makeRuntime(),
        });

        expect(serveStatic).toHaveBeenCalledWith({
            root: "/project/dist/client",
            rewriteRequestPath: expect.any(Function),
        });
        expect(serveStaticConfig).toBeDefined();
        const rewriteRequestPath = serveStaticConfig?.rewriteRequestPath;
        if (!rewriteRequestPath) {
            throw new Error("serveStatic config was not captured");
        }
        expect(rewriteRequestPath("/docs/")).toBe("/__nosuchfile__");
        expect(rewriteRequestPath("/docs")).toBe("/docs");

        expect(serve).toHaveBeenCalledWith(
            {
                fetch: expect.any(Function),
                port: 3001,
            },
            expect.any(Function),
        );
        expect(log).toHaveBeenCalledWith(
            expect.stringContaining("Server running at http://localhost:3001"),
        );
    });

    test("uses Deno.serve for Deno production runtimes", async () => {
        const app = new Hono();
        const denoServe = vi.fn();
        vi.stubGlobal("Deno", { serve: denoServe });

        await startServer({
            app,
            root: "/project",
            isProduction: true,
            runtime: makeRuntime({ isDeno: true }),
        });

        expect(denoServe).toHaveBeenCalledWith({ port: 3000 }, app.fetch);
        expect(dynamicImport).not.toHaveBeenCalled();
    });

    test("returns without additional startup work for Bun production runtimes", async () => {
        const app = new Hono();
        const vite = { id: "vite" };

        const result = await startServer({
            app,
            root: "/project",
            isProduction: true,
            vite: vite as never,
            runtime: makeRuntime({ isBun: true }),
        });

        expect(result).toEqual({ vite });
        expect(dynamicImport).not.toHaveBeenCalled();
    });
});

function makeRuntime(
    overrides: Partial<{
        isDeno: boolean;
        isBun: boolean;
        isVercel: boolean;
        isProduction: boolean;
    }> = {},
): {
    isDeno: boolean;
    isBun: boolean;
    isVercel: boolean;
    isProduction: boolean;
} {
    return {
        isDeno: false,
        isBun: false,
        isVercel: false,
        isProduction: false,
        ...overrides,
    };
}
