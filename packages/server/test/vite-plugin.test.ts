vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));
vi.mock("@finesoft/ssr", async () => import("../../ssr/src/index.ts"));

import { finesoftFrontViteConfig } from "../src/vite-plugin";

const tempDirs: string[] = [];

describe("finesoftFrontViteConfig", () => {
    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("generates a virtual i18n loader from locale JSON files", async () => {
        const randomId = Math.random().toString(36).slice(2);
        const root = join(tmpdir(), `finesoft-front-i18n-${Date.now()}-${randomId}`);
        const messagesDir = join(root, "src", "locales");
        mkdirSync(messagesDir, { recursive: true });
        writeFileSync(join(messagesDir, "en-US.json"), '{"hello":"Hello"}');
        tempDirs.push(root);

        const plugin = finesoftFrontViteConfig({
            i18n: {
                messagesDir: "src/locales",
            },
        }) as {
            config: (config: Record<string, unknown>) => Record<string, unknown>;
            configResolved: (config: Record<string, unknown>) => void;
            resolveId: (id: string) => string | null;
            load: (id: string) => string | Promise<string | null> | null;
        };

        const config = plugin.config({});
        expect(config.define).toMatchObject({});

        plugin.configResolved({
            root,
            command: "serve",
            resolve: {},
            css: {},
        });

        expect(plugin.resolveId("virtual:finesoft-front/i18n-loader")).toBe(
            "\0virtual:finesoft-front/i18n-loader",
        );

        const code = await plugin.load("\0virtual:finesoft-front/i18n-loader");
        expect(code).toContain('import.meta.glob("/src/locales/*.json"');
        expect(code).toContain('locale + ".json"');
    });
});

test("build identity is automatic, inherited by subbuilds, and configurable for custom hosts", () => {
    const first = finesoftFrontViteConfig().config({});
    const next = finesoftFrontViteConfig().config({});
    expect(first.define.__FINESOFT_BUILD_ID__).not.toBe(next.define.__FINESOFT_BUILD_ID__);
    const paired = finesoftFrontViteConfig().config({ define: first.define });
    expect(paired.define.__FINESOFT_BUILD_ID__).toBe(first.define.__FINESOFT_BUILD_ID__);
    expect(
        finesoftFrontViteConfig({ buildId: "release-id" }).config({}).define.__FINESOFT_BUILD_ID__,
    ).toBe('"release-id"');
});
