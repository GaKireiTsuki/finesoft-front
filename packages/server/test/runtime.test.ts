import { afterEach, describe, expect, test, vi } from "vite-plus/test";

const { dynamicImport } = vi.hoisted(() => ({
    dynamicImport: vi.fn(),
}));

vi.mock("../src/dynamic-import", () => ({
    dynamicImport,
}));

import { detectRuntime, resolveRoot } from "../src/runtime";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.VERCEL;
    delete process.env.NODE_ENV;
    dynamicImport.mockReset();
});

describe("runtime helpers", () => {
    test("detects the active runtime environment", () => {
        vi.stubGlobal("Deno", {});
        vi.stubGlobal("Bun", {});
        process.env.VERCEL = "1";
        process.env.NODE_ENV = "production";

        expect(detectRuntime()).toEqual({
            isDeno: true,
            isBun: true,
            isVercel: true,
            isProduction: true,
        });
    });

    test("resolves roots directly in Deno mode", async () => {
        vi.stubGlobal("Deno", {});

        await expect(resolveRoot("file:///tmp/project/src/entry.ts", 1)).resolves.toBe(
            "/tmp/project/",
        );
        await expect(resolveRoot("file:///tmp/project/src/entry.ts", 2)).resolves.toBe("/tmp/");
    });

    test("resolves roots with node:path and node:url outside Deno", async () => {
        dynamicImport.mockImplementation(async (specifier: string) => {
            if (specifier === "node:path") {
                return import("node:path");
            }
            if (specifier === "node:url") {
                return import("node:url");
            }
            throw new Error(`unexpected import: ${specifier}`);
        });

        await expect(resolveRoot("file:///tmp/project/src/entry.ts", 1)).resolves.toBe(
            "/tmp/project",
        );
        expect(dynamicImport).toHaveBeenCalledWith("node:path");
        expect(dynamicImport).toHaveBeenCalledWith("node:url");
    });
});
