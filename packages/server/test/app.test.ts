vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));
vi.mock("@finesoft/ssr", async () => import("../../ssr/src/index.ts"));

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createSSRApp } from "../src/app";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("createSSRApp is the Vite development wrapper around the portable SSR host", async () => {
    const root = join(tmpdir(), `finesoft-front-dev-${Date.now()}-${Math.random()}`);
    roots.push(root);
    mkdirSync(root, { recursive: true });
    writeFileSync(
        root + "/index.html",
        "<html><head><!--ssr-head--></head><body><!--ssr-body--><!--ssr-data--></body></html>",
    );
    const vite = {
        transformIndexHtml: vi.fn(async (_url: string, html: string) => html),
        ssrLoadModule: vi.fn(async () => ({
            render: (url: string) => ({
                html: `<main>${url}</main>`,
                head: "",
                css: "",
                serverData: { pages: [] },
            }),
            serializeServerData: JSON.stringify,
        })),
        ssrFixStacktrace: vi.fn(),
    };
    const app = createSSRApp({ root, vite: vite as never });
    const response = await app.request("http://localhost/docs?tab=1");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<main>/docs?tab=1</main>");
    expect(vite.transformIndexHtml).toHaveBeenCalledWith("/docs?tab=1", expect.any(String));
    expect(vite.ssrLoadModule).toHaveBeenCalledWith("/src/ssr.ts");
    await app.dispose();
});
