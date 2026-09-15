import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test, vi } from "vite-plus/test";
const { dynamicImport } = vi.hoisted(() => ({ dynamicImport: vi.fn() }));
vi.mock("../../src/dynamic-import", () => ({ dynamicImport }));
import { staticAdapter } from "../../src/adapters/static";
afterEach(() => {
    vi.restoreAllMocks();
    dynamicImport.mockReset();
});
function fixture(overrides: Record<string, unknown> = {}) {
    const files = new Map<string, string>();
    const render = Object.assign(
        vi.fn(async (url: string, _context?: unknown) => ({
            html: `<main>${url}</main>`,
            head: "",
            css: "",
            serverData: [],
            locale: "ar",
            slots: { extra: "<aside>slot</aside>" },
            ...overrides,
        })),
        {
            routes: [{ path: "/" }, { path: "/client" }, { path: "/product/:id" }],
            dispose: vi.fn(async () => {}),
        },
    );
    const context = {
        root: "/project",
        path,
        templateHtml:
            '<html><head><!--ssr-head--></head><body><div id="app"><!--ssr-body--><!--ssr-data--></div><!--ssr-extra--></body></html>',
        renderModes: { "/client": "csr", "/product/*": "prerender" },
        defaultLocale: "en",
        resolvedResolve: {},
        vite: { build: vi.fn(async () => {}) },
        copyStaticAssets: vi.fn(),
        fs: {
            rmSync: vi.fn(),
            mkdirSync: vi.fn(),
            writeFileSync: vi.fn((file: string, value: string) => files.set(file, value)),
        },
    };
    dynamicImport.mockImplementation(async (specifier: string) => {
        if (specifier === "node:url") return { pathToFileURL };
        if (specifier.includes("/ssr.js?build="))
            return { render, serializeServerData: JSON.stringify };
        if (specifier.includes("/_routes.mjs?build="))
            return { app: { routes: [{ path: "/explicit" }] } };
        throw Error("Unexpected module " + specifier);
    });
    return { files, render, context };
}
test("built routes, shared slots/locale/wire HTML, CSR and dynamic override; renderer disposed", async () => {
    const { files, render, context } = fixture();
    await staticAdapter({ dynamicRoutes: ["/product/42"] }).build(context as never);
    expect(context.vite.build).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(2);
    expect(files.get("/project/dist/static/index.html")).toContain('lang="ar" dir="rtl"');
    expect(files.get("/project/dist/static/index.html")).toContain("data-fs-server-data");
    expect(files.get("/project/dist/static/index.html")).toContain("<aside>slot</aside>");
    expect(files.get("/project/dist/static/client/index.html")).not.toContain(
        "data-fs-server-data",
    );
    expect(files.get("/project/dist/static/client/index.html")).toContain('lang="en"');
    expect(files.get("/project/dist/static/product/42/index.html")).toContain("/product/42");
    expect(render.mock.calls[0]?.[1]).toMatchObject({ request: expect.any(Request) });
    expect(render.dispose).toHaveBeenCalledOnce();
});
test("explicit Web definition route module remains an optional extension", async () => {
    const { files, context, render } = fixture();
    await staticAdapter({ routesExport: "src/pages.ts" }).build(context as never);
    expect(context.vite.build).toHaveBeenCalledOnce();
    expect(files.has("/project/dist/static/explicit/index.html")).toBe(true);
    expect(context.fs.rmSync).toHaveBeenCalledWith("/project/dist/server/_routes.mjs", {
        force: true,
    });
    expect(render.dispose).toHaveBeenCalledOnce();
});
test.each([
    { status: 403 },
    { redirect: { url: "/login", status: 302 } },
    { headers: { "Set-Cookie": "session=private" } },
    { headers: { "X-Policy": "required" } },
])(
    "rejects unrepresentable HTTP behavior %j and disposes without successful output",
    async (result) => {
        const { files, context, render } = fixture(result);
        await expect(staticAdapter().build(context as never)).rejects.toThrow(/Static route/);
        expect(files.size).toBe(0);
        expect(render.dispose).toHaveBeenCalledOnce();
    },
);
test("discovery failures surface and still await owned renderer cleanup", async () => {
    const { context, render } = fixture();
    context.vite.build.mockRejectedValue(Error("discovery failed"));
    await expect(
        staticAdapter({ routesExport: "missing.ts" }).build(context as never),
    ).rejects.toThrow("discovery failed");
    expect(render.dispose).toHaveBeenCalledOnce();
});
test("render failures become failed builds and still await cleanup", async () => {
    const { context, render } = fixture();
    render.mockRejectedValue(Error("private failure"));
    await expect(staticAdapter().build(context as never)).rejects.toThrow("HTTP 500");
    expect(render.dispose).toHaveBeenCalledOnce();
});
