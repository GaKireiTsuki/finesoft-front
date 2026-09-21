import { Hono } from "hono";
import type { ViteDevServer } from "vite";
import { nodeSafeFetchOptions } from "./node/fetch-policy";
import { createSSRHandler } from "./ssr-handler";
import type { SSRModule } from "./ssr-handler";
import { dynamicImport } from "./dynamic-import";

/**
 * Vite's development middleware bridge. Production adapters compose the same
 * portable SSR host directly, so this module owns only dev template transforms,
 * hot SSR-module loading, and Vite stack-trace repair.
 */
export interface SSRAppOptions {
    readonly root: string;
    readonly vite: ViteDevServer;
    readonly ssrEntryPath?: string;
    readonly parentFetch?: (
        request: Request,
        bindings?: Readonly<Record<string, unknown>>,
    ) => Response | Promise<Response>;
    readonly renderModes?: Record<string, string>;
    readonly defaultLocale?: string;
}

export function createSSRApp(
    options: SSRAppOptions,
): Hono<{ Bindings: Record<string, unknown> }> & { dispose(): Promise<void> } {
    const {
        root,
        vite,
        ssrEntryPath = "/src/ssr.ts",
        parentFetch,
        renderModes,
        defaultLocale,
    } = options;
    const app = new Hono<{ Bindings: Record<string, unknown> }>();

    const owner = createSSRHandler({
        ownRenderers: true,
        template: async (request) => {
            const { readFileSync } = await dynamicImport("node:fs");
            const path = await dynamicImport("node:path");
            const raw = readFileSync(path.resolve(root, "index.html"), "utf-8");
            const url = new URL(request.url);
            return vite.transformIndexHtml(url.pathname + url.search, raw);
        },
        loadModule: async () => (await vite.ssrLoadModule(ssrEntryPath)) as SSRModule,
        renderModes,
        defaultLocale,
        fetch: parentFetch,
        safeFetch: nodeSafeFetchOptions,
        onError: (error) => {
            vite.ssrFixStacktrace(error as Error);
            console.error("[SSR Error]", error);
        },
    });
    app.all("*", (context) => owner.fetch(context.req.raw, context.env));
    return Object.assign(app, { dispose: owner.dispose });
}

export type { SSRModule } from "./ssr-handler";
