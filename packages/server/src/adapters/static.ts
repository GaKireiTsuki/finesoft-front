/** Build static HTML through the same SSR response assembler used by request hosts. */
import { dynamicImport } from "../dynamic-import";
import { createSSRHandler } from "../ssr-handler";
import { matchRenderModeOverride, type SSRModule } from "../ssr-handler";
import type { Adapter, AdapterContext } from "./types";

export interface StaticAdapterOptions {
    /** Optional module exporting routes or a Web definition; built render.routes is the default. */
    routesExport?: string;
    /** Concrete pathnames for dynamic routes, e.g. /products/42. */
    dynamicRoutes?: string[];
}
type StaticRoute = { readonly path: string; readonly renderMode?: string };
export function staticAdapter(options: StaticAdapterOptions = {}): Adapter {
    return {
        name: "static",
        async build(context) {
            const { fs, path, root } = context;
            context = { ...context, buildId: context.buildId ?? crypto.randomUUID() };
            const { pathToFileURL } = await dynamicImport("node:url");
            const module: SSRModule = await dynamicImport(
                `${pathToFileURL(path.resolve(root, "dist/server/ssr.js")).href}?build=${encodeURIComponent(context.buildId!)}`,
            );
            const modes = { ...context.renderModes };
            const host = createSSRHandler({
                ownRenderers: true,
                ...module,
                template: context.templateHtml,
                renderModes: modes,
                defaultLocale: context.defaultLocale,
            });
            try {
                const routes = await discoverRoutes(context, options, module);
                const urls = new Set([
                    ...routes
                        .filter((route) => !/[:*]/.test(route.path))
                        .map((route) => route.path),
                    ...(options.dynamicRoutes ?? []),
                ]);
                if (!urls.size) throw Error("Static build requires at least one concrete route");
                const pages = new Map<string, string>();
                for (const url of urls) {
                    if (
                        !url.startsWith("/") ||
                        new URL(url, "https://static.local").pathname !== url
                    )
                        throw Error(`Static route must be a normalized pathname: ${url}`);
                    const mode =
                        matchRenderModeOverride(url, context.renderModes) ??
                        routes.find((route) => route.path === url)?.renderMode;
                    if (mode) modes[url] = mode;
                    const response = await host.fetch(new Request("https://static.local" + url));
                    const html = await response.text();
                    if (response.status !== 200)
                        throw Error(
                            `Static route ${url} returned HTTP ${response.status}; use a request host for redirects/errors`,
                        );
                    for (const name of response.headers.keys()) {
                        if (name !== "content-type")
                            throw Error(
                                `Static route ${url} requires HTTP header ${name}; configure a request host instead`,
                            );
                    }
                    pages.set(url, html);
                }
                const output = path.resolve(root, "dist/static");
                fs.rmSync(output, { recursive: true, force: true });
                fs.mkdirSync(output, { recursive: true });
                context.copyStaticAssets(output, { excludeHtml: true });
                for (const [url, html] of pages) {
                    const file = path.join(output, url, "index.html");
                    fs.mkdirSync(path.resolve(file, ".."), { recursive: true });
                    fs.writeFileSync(file, html);
                }
                console.log(`  Static output → dist/static/ (${pages.size} pages)\n`);
            } finally {
                await host.dispose();
            }
        },
    };
}
async function discoverRoutes(
    context: AdapterContext,
    options: StaticAdapterOptions,
    module: SSRModule,
): Promise<readonly StaticRoute[]> {
    if (!options.routesExport) {
        if (!module.render.routes)
            throw Error("Static renderer must expose routes, or supply routesExport");
        return module.render.routes;
    }
    const output = context.path.resolve(context.root, "dist/server/_routes.mjs");
    try {
        await context.vite.build({
            root: context.root,
            build: {
                ssr: options.routesExport,
                outDir: context.path.resolve(context.root, "dist/server"),
                emptyOutDir: false,
                rollupOptions: { output: { entryFileNames: "_routes.mjs" } },
            },
            resolve: context.resolvedResolve,
        });
        const { pathToFileURL } = await dynamicImport("node:url");
        const loaded = await dynamicImport(
            `${pathToFileURL(output).href}?build=${encodeURIComponent(context.buildId!)}`,
        );
        const routes =
            loaded.routes ?? loaded.app?.routes ?? loaded.default?.routes ?? loaded.default;
        if (!Array.isArray(routes))
            throw Error("routesExport must expose a route array or Web definition");
        return routes;
    } finally {
        context.fs.rmSync(output, { force: true });
    }
}
