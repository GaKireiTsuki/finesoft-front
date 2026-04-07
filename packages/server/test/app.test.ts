import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));
vi.mock("@finesoft/ssr", async () => import("../../ssr/src/index.ts"));

import { createSSRApp } from "../src/app";

const tempDirs: string[] = [];

const appGlobals = globalThis as typeof globalThis & {
    __APP_RENDER_CALLS__?: number;
    __APP_INTERNAL_FETCH_TEXT__?: string;
};

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }

    delete appGlobals.__APP_RENDER_CALLS__;
    delete appGlobals.__APP_INTERNAL_FETCH_TEXT__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("createSSRApp", () => {
    test("rejects recursive SSR loops before rendering", async () => {
        const app = createSSRApp({
            root: "/unused",
            isProduction: true,
        });

        const response = await app.request("http://localhost/loop", {
            headers: { "x-ssr-depth": "5" },
        });

        expect(response.status).toBe(508);
        expect(await response.text()).toBe("SSR recursion loop detected");
    });

    test("returns a localized CSR shell for config-level glob overrides", async () => {
        appGlobals.__APP_RENDER_CALLS__ = 0;

        const root = createTempServerRoot({
            "dist/client/index.html":
                "<html><head><!--ssr-head--></head><body><!--ssr-body--><!--ssr-data--></body></html>",
        });
        const modulePath = writeTempFile(
            root,
            "dist/server/csr-shell.mjs",
            `
export async function render() {
  globalThis.__APP_RENDER_CALLS__ = (globalThis.__APP_RENDER_CALLS__ ?? 0) + 1;
  return { html: "<main>ignored</main>", head: "", css: "", serverData: [] };
}

export function serializeServerData(data) {
  return JSON.stringify(data);
}
`,
        );

        const app = createSSRApp({
            root,
            isProduction: true,
            ssrProductionModule: pathToFileURL(modulePath).href,
            renderModes: {
                "/docs/*": "csr",
            },
            defaultLocale: "ja-JP",
        });

        const response = await app.request("http://localhost/docs/getting-started");
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(appGlobals.__APP_RENDER_CALLS__).toBe(0);
        expect(html).toContain('<html lang="ja-JP" dir="ltr">');
        expect(html).toContain("<body></body>");
        expect(html).not.toContain("ignored");
    });

    test("ignores non-matching renderMode overrides and renders normally", async () => {
        const root = createTempServerRoot({
            "dist/client/index.html":
                "<html><head><!--ssr-head--></head><body><!--ssr-body--><!--ssr-data--></body></html>",
        });
        const modulePath = writeTempFile(
            root,
            "dist/server/unmatched-override.mjs",
            `
export async function render(url) {
  return {
    html: '<main>' + url + '</main>',
    head: '',
    css: '',
    serverData: []
  };
}

export function serializeServerData(data) {
  return JSON.stringify(data);
}
`,
        );

        const app = createSSRApp({
            root,
            isProduction: true,
            ssrProductionModule: pathToFileURL(modulePath).href,
            renderModes: {
                "/docs/*": "csr",
            },
        });

        const response = await app.request("http://localhost/blog/post-1");
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(html).toContain("<main>/blog/post-1</main>");
        expect(html).toContain(
            '<script id="serialized-server-data" type="application/json">[]</script>',
        );
    });

    test("caches prerender output and wires parentFetch through internal SSR fetch", async () => {
        appGlobals.__APP_RENDER_CALLS__ = 0;

        const root = createTempServerRoot({
            "dist/client/index.html":
                "<html><head><!--ssr-head--></head><body><!--ssr-body--><!--ssr-data--></body></html>",
            "dist/server/ssr.js": `
export async function render(url, ssrContext) {
  globalThis.__APP_RENDER_CALLS__ = (globalThis.__APP_RENDER_CALLS__ ?? 0) + 1;
  const response = await ssrContext.fetch("/api/hello");
  globalThis.__APP_INTERNAL_FETCH_TEXT__ = await response.text();
  return {
    html: '<main>' + url + ':' + globalThis.__APP_INTERNAL_FETCH_TEXT__ + '</main>',
    head: '<meta name="x-test" content="1">',
    css: '.app{color:red}',
    serverData: [{ url }],
    locale: { lang: 'en-US', dir: 'ltr' }
  };
}

export function serializeServerData(data) {
  return JSON.stringify(data);
}
`,
        });

        const parentFetch = vi.fn(async (request: Request) => {
            expect(request.url).toBe("http://localhost/api/hello");
            expect(request.headers.get("x-ssr-depth")).toBe("1");
            return new Response("internal-ok");
        });

        const app = createSSRApp({
            root,
            isProduction: true,
            parentFetch,
            renderModes: {
                "/cached": "prerender",
            },
        });

        const first = await app.request("http://localhost/cached?view=1");
        const second = await app.request("http://localhost/cached?view=1");
        const firstHtml = await first.text();
        const secondHtml = await second.text();

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(firstHtml).toContain("<main>/cached?view=1:internal-ok</main>");
        expect(firstHtml).toContain('<script id="serialized-server-data" type="application/json">');
        expect(secondHtml).toBe(firstHtml);
        expect(appGlobals.__APP_RENDER_CALLS__).toBe(1);
        expect(appGlobals.__APP_INTERNAL_FETCH_TEXT__).toBe("internal-ok");
        expect(parentFetch).toHaveBeenCalledTimes(1);
    });

    test("evicts the oldest prerendered HTML when the ISR cache overflows", async () => {
        appGlobals.__APP_RENDER_CALLS__ = 0;

        const root = createTempServerRoot({
            "dist/client/index.html":
                "<html><head><!--ssr-head--></head><body><!--ssr-body--><!--ssr-data--></body></html>",
            "dist/server/ssr.js": `
export async function render(url) {
  globalThis.__APP_RENDER_CALLS__ = (globalThis.__APP_RENDER_CALLS__ ?? 0) + 1;
  return {
    html: '<main>' + url + '</main>',
    head: '',
    css: '',
    serverData: [],
  };
}

export function serializeServerData(data) {
  return JSON.stringify(data);
}
`,
        });

        const app = createSSRApp({
            root,
            isProduction: true,
            renderModes: {
                "/page-*": "prerender",
            },
        });

        for (let index = 0; index <= 1000; index += 1) {
            await app.request(`http://localhost/page-${index}`);
        }

        await app.request("http://localhost/page-0");

        expect(appGlobals.__APP_RENDER_CALLS__).toBe(1002);
    });

    test("reads production templates through Deno when that runtime is available", async () => {
        const denoReadTextFileSync = vi.fn(
            () =>
                "<html><head><!--ssr-head--></head><body><!--ssr-body--><!--ssr-data--></body></html>",
        );
        vi.stubGlobal("Deno", {
            readTextFileSync: denoReadTextFileSync,
        });

        const root = createTempServerRoot({});
        const modulePath = writeTempFile(
            root,
            "dist/server/deno-ssr.mjs",
            `
export async function render(url) {
  return {
    html: '<main>' + url + '</main>',
    head: '',
    css: '',
    serverData: [],
    locale: { lang: 'en-US', dir: 'ltr' }
  };
}

export function serializeServerData(data) {
  return JSON.stringify(data);
}
`,
        );

        const app = createSSRApp({
            root,
            isProduction: true,
            ssrProductionModule: pathToFileURL(modulePath).href,
        });

        const response = await app.request("http://localhost/deno");
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(denoReadTextFileSync).toHaveBeenCalledTimes(1);
        expect(denoReadTextFileSync).toHaveBeenCalledWith(expect.any(URL));
        expect(html).toContain("<main>/deno</main>");
        expect(html).toContain('<html lang="en-US" dir="ltr">');
    });

    test("handles middleware redirects and route-level CSR responses", async () => {
        const root = createTempServerRoot({
            "dist/client/index.html":
                "<html><head><!--ssr-head--></head><body><!--ssr-body--><!--ssr-data--></body></html>",
        });
        const modulePath = writeTempFile(
            root,
            "dist/server/redirect-or-csr.mjs",
            `
export async function render(url) {
  if (url === "/redirect") {
    return {
      html: "",
      head: "",
      css: "",
      serverData: [],
      redirect: { url: "/login", status: 301 }
    };
  }

  return {
    html: "<main>ignored</main>",
    head: "",
    css: "",
    serverData: [],
    renderMode: "csr"
  };
}

export function serializeServerData(data) {
  return JSON.stringify(data);
}
`,
        );

        const app = createSSRApp({
            root,
            isProduction: true,
            ssrProductionModule: pathToFileURL(modulePath).href,
        });

        const redirectResponse = await app.request("http://localhost/redirect");
        const csrResponse = await app.request("http://localhost/client-only");
        const csrHtml = await csrResponse.text();

        expect(redirectResponse.status).toBe(301);
        expect(redirectResponse.headers.get("location")).toBe("/login");
        expect(csrResponse.status).toBe(200);
        expect(csrHtml).toContain("<body></body>");
        expect(csrHtml).not.toContain("ignored");
    });

    test("fixes stack traces and returns 500s when dev SSR loading fails", async () => {
        const root = createTempServerRoot({
            "index.html":
                "<html><head><!--ssr-head--></head><body><!--ssr-body--><!--ssr-data--></body></html>",
        });
        const vite = {
            transformIndexHtml: vi.fn(async (_url: string, template: string) => template),
            ssrLoadModule: vi.fn(async () => ({})),
            ssrFixStacktrace: vi.fn(),
        };
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        const app = createSSRApp({
            root,
            isProduction: false,
            vite: vite as never,
        });

        const response = await app.request("http://localhost/broken");

        expect(response.status).toBe(500);
        expect(await response.text()).toBe("Internal Server Error");
        expect(vite.transformIndexHtml).toHaveBeenCalledWith(
            "/broken",
            expect.stringContaining("<!--ssr-head-->"),
        );
        expect(vite.ssrLoadModule).toHaveBeenCalledWith("/src/ssr.ts");
        expect(vite.ssrFixStacktrace).toHaveBeenCalledWith(expect.any(Error));
        expect(error).toHaveBeenCalledWith("[SSR Error]", expect.any(Error));
    });
});

function createTempServerRoot(files: Record<string, string>): string {
    const root = join(
        tmpdir(),
        `finesoft-front-app-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    tempDirs.push(root);

    for (const [relativePath, content] of Object.entries(files)) {
        writeTempFile(root, relativePath, content);
    }

    return root;
}

function writeTempFile(root: string, relativePath: string, content: string): string {
    const filePath = join(root, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
    return filePath;
}
