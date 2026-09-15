import { getLocaleAttributes, LruMap, type SecureFetchOptions } from "@finesoft/core";
import { injectCSRShell, injectSSRContent } from "@finesoft/ssr/inject";
import { createInternalFetch, MAX_SSR_DEPTH, SSR_DEPTH_HEADER } from "./internal-fetch";

export interface SSRRequestContext {
    readonly request: Request;
    readonly bindings: Readonly<Record<string, unknown>>;
    readonly fetch?: typeof globalThis.fetch;
    readonly safeFetch?: SecureFetchOptions;
}
export interface SSRResponseResult {
    html: string;
    head: string;
    css: string;
    serverData: unknown;
    renderMode?: string;
    redirect?: { url: string; status: number };
    slots?: Record<string, string>;
    locale?: { lang: string; dir: string } | string;
    status?: number;
    headers?: HeadersInit;
    rewriteUrl?: string;
    /** Explicit guarantee that this result is public and independent of request bindings. */
    cache?: "public";
}
export interface SSRModule {
    render: (
        url: string,
        context?: SSRRequestContext,
    ) => SSRResponseResult | Promise<SSRResponseResult>;
    serializeServerData: (data: unknown) => string;
}
export interface SSRCache {
    get(key: string): string | null | undefined | Promise<string | null | undefined>;
    set(key: string, html: string): void | Promise<void>;
}
export interface SSRHandlerOptions extends SSRModule {
    template: string | ((request: Request) => string | Promise<string>);
    renderModes?: Record<string, string>;
    defaultLocale?: string;
    /** Internal dispatcher; receives the current invocation bindings. */
    fetch?: (
        request: Request,
        bindings?: Readonly<Record<string, unknown>>,
    ) => Response | Promise<Response>;
    safeFetch?: SecureFetchOptions;
    /** Omit to use a bounded process-local cache. Only explicitly public responses qualify. */
    cache?: SSRCache;
    onError?: (error: unknown) => void;
    publicCacheHeaders?: Record<string, string>;
}
export function matchRenderModeOverride(
    url: string,
    renderModes?: Record<string, string>,
): string | undefined {
    const path = url.split("?")[0];
    if (renderModes?.[path]) return renderModes[path];
    for (const [pattern, mode] of Object.entries(renderModes ?? {})) {
        if (pattern.includes("*")) {
            const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
            if (new RegExp("^" + escaped.replace(/\*/g, ".*") + "$").test(path)) return mode;
        }
    }
    return undefined;
}
/** Standard Request/Response HTML assembly; owns no Node, Hono, filesystem or Vite state. */
export function createSSRHandler(options: SSRHandlerOptions) {
    const cache = options.cache ?? new LruMap<string, string>(1000);
    return async (
        request: Request,
        bindings: Readonly<Record<string, unknown>> = {},
    ): Promise<Response> => {
        const parsed = new URL(request.url);
        const url = parsed.pathname + parsed.search;
        const depth = Number(request.headers.get(SSR_DEPTH_HEADER) ?? 0);
        if (!Number.isInteger(depth) || depth < 0 || depth >= MAX_SSR_DEPTH)
            return new Response("SSR recursion loop detected", { status: 508 });
        if (request.method !== "GET" && request.method !== "HEAD")
            return new Response("Method not allowed", {
                status: 405,
                headers: { Allow: "GET, HEAD" },
            });
        try {
            request.signal.throwIfAborted();
            const template =
                typeof options.template === "string"
                    ? options.template
                    : await options.template(request);
            const override = matchRenderModeOverride(url, options.renderModes);
            const defaultLocale = options.defaultLocale
                ? getLocaleAttributes(options.defaultLocale)
                : undefined;
            const respond = (html: string, status = 200, headers = new Headers()) => {
                if (!headers.has("content-type"))
                    headers.set("content-type", "text/html; charset=utf-8");
                return new Response(
                    request.method === "HEAD" || status === 204 || status === 304 ? null : html,
                    { status, headers },
                );
            };
            if (override === "csr") return respond(injectCSRShell(template, defaultLocale));
            const publicRequest =
                !request.headers.has("cookie") && !request.headers.has("authorization");
            const result = await options.render(url, {
                request,
                bindings,
                safeFetch: options.safeFetch,
                fetch: options.fetch
                    ? createInternalFetch(options.fetch, depth + 1, { request, bindings })
                    : undefined,
            });
            request.signal.throwIfAborted();
            const headers = new Headers(result.headers);
            if (result.redirect) {
                headers.set("location", result.redirect.url);
                return new Response(null, { status: result.redirect.status, headers });
            }
            const locale =
                typeof result.locale === "string"
                    ? getLocaleAttributes(result.locale)
                    : (result.locale ?? defaultLocale);
            if (result.rewriteUrl) headers.set("content-location", result.rewriteUrl);
            const mode = override ?? result.renderMode;
            // Render (including request policies) always runs before shared HTML cache access.
            // The cache saves assembly only; operation caches own data-loading performance.
            const eligible =
                mode === "prerender" &&
                publicRequest &&
                result.cache === "public" &&
                (result.status ?? 200) === 200 &&
                !result.rewriteUrl &&
                [...headers].length === 0;
            const cacheKey = JSON.stringify([parsed.href, locale?.lang, locale?.dir]);
            const cached = eligible ? await cache.get(cacheKey) : undefined;
            if (cached !== undefined && cached !== null)
                return respond(cached, 200, new Headers(options.publicCacheHeaders));
            const html =
                mode === "csr"
                    ? injectCSRShell(template, locale)
                    : injectSSRContent({
                          template,
                          html: result.html,
                          head: result.head,
                          css: result.css,
                          serializedData: options.serializeServerData(result.serverData),
                          slots: result.slots,
                          locale,
                      });
            // Cache only metadata-free 200 public HTML: never discard/replay cookies or custom headers.
            if (eligible) {
                await cache.set(cacheKey, html);
                for (const [key, value] of Object.entries(options.publicCacheHeaders ?? {}))
                    headers.set(key, value);
            }
            return respond(html, result.status, headers);
        } catch (error) {
            try {
                options.onError?.(error);
            } catch {
                /* Reporting cannot replace the safe response. */
            }
            return new Response(
                request.signal.aborted ? "Execution cancelled" : "Internal Server Error",
                { status: request.signal.aborted ? 499 : 500 },
            );
        }
    };
}
