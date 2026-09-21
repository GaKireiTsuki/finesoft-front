import { getLocaleAttributes, LruMap, type SecureFetchOptions } from "@finesoft/core";
import { injectCSRShell, injectSSRContent } from "@finesoft/ssr/inject";
import { createInternalFetch, MAX_SSR_DEPTH, SSR_DEPTH_HEADER } from "./internal-fetch";
import { isPublicSSRResult } from "./ssr-cache";
import type { HttpHandler } from "./http";
import {
    SERVER_CONTROLLER_PATH,
    parseCookieString,
    type ServerControllerRequest,
    type ServerRequestState,
} from "@finesoft/web";

export interface SSRRequestContext {
    readonly request: Request;
    readonly bindings: Readonly<Record<string, unknown>>;
    readonly fetch?: typeof globalThis.fetch;
    readonly safeFetch?: SecureFetchOptions;
    readonly requestState?: ServerRequestState;
}
export interface SSRResponseResult<TData = unknown> {
    html: string;
    head: string;
    css: string;
    serverData: TData;
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
export interface SSRModule<TData = unknown> {
    render: ((
        url: string,
        context?: SSRRequestContext,
    ) => SSRResponseResult<TData> | Promise<SSRResponseResult<TData>>) & {
        dispose?(): Promise<void>;
        readonly routes?: readonly { readonly path: string; readonly renderMode?: string }[];
        controller?(
            input: ServerControllerRequest,
            context: SSRRequestContext,
        ): Promise<SSRResponseResult<TData>>;
    };
    serializeServerData: (data: TData) => string;
}
export interface SSRCache {
    get(key: string): string | null | undefined | Promise<string | null | undefined>;
    set(key: string, html: string): void | Promise<void>;
}
interface SSRHandlerBaseOptions {
    /** Transfer loaded renderer shutdown to this handler. Default: borrowed renderers. */
    readonly ownRenderers?: boolean;
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
/** Load a module per invocation when the host selects its renderer/serializer dynamically. */
export type SSRHandlerOptions<TData = unknown> = SSRHandlerBaseOptions &
    (
        | SSRModule<TData>
        | {
              loadModule: (request: Request) => SSRModule<TData> | Promise<SSRModule<TData>>;
          }
    );
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
export interface SSRHandler extends HttpHandler {
    dispose(this: void): Promise<void>;
}
/** Standard Request/Response HTML assembly; owns no Node, Hono, filesystem or Vite state. */
export function createSSRHandler<TData = unknown>(options: SSRHandlerOptions<TData>): SSRHandler {
    const cache = options.cache ?? new LruMap<string, string>(1000);
    const ownRenderers = options.ownRenderers ?? false;
    const owners = new Set<SSRModule<TData>["render"]>();
    if (ownRenderers && "render" in options) owners.add(options.render);
    const active = new Set<Promise<Response>>();
    let closing: Promise<void> | undefined;
    const respond = async (
        request: Request,
        bindings: Readonly<Record<string, unknown>> = {},
    ): Promise<Response> => {
        const parsed = new URL(request.url);
        const url = parsed.pathname + parsed.search;
        const depth = Number(request.headers.get(SSR_DEPTH_HEADER) ?? 0);
        const remote = parsed.pathname === SERVER_CONTROLLER_PATH;
        if (!Number.isInteger(depth) || depth < 0 || depth >= MAX_SSR_DEPTH)
            return new Response("SSR recursion loop detected", { status: 508 });
        if (
            remote &&
            (request.method !== "POST" ||
                request.headers.get("origin") !== parsed.origin ||
                request.headers.get("x-finesoft-controller") !== "1" ||
                request.headers.get("sec-fetch-site") === "cross-site" ||
                request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
        )
            return new Response("Forbidden", {
                status: 403,
                headers: { "cache-control": "no-store" },
            });
        if (!remote && request.method !== "GET" && request.method !== "HEAD")
            return new Response("Method not allowed", {
                status: 405,
                headers: { Allow: "GET, HEAD" },
            });
        const requestState: ServerRequestState = {
            request,
            responseHeaders: new Headers(),
            remote,
            cookies: parseCookieString(request.headers.get("cookie") ?? ""),
        };
        try {
            request.signal.throwIfAborted();
            const template = remote
                ? ""
                : typeof options.template === "string"
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
            if (!remote && override === "csr")
                return respond(injectCSRShell(template, defaultLocale));
            const publicRequest =
                !request.headers.has("cookie") && !request.headers.has("authorization");
            const module = "loadModule" in options ? await options.loadModule(request) : options;
            if (ownRenderers) owners.add(module.render);
            const context: SSRRequestContext = {
                request,
                bindings,
                requestState,
                safeFetch: options.safeFetch,
                fetch: options.fetch
                    ? createInternalFetch(options.fetch, depth + 1, {
                          request,
                          bindings,
                      })
                    : undefined,
            };
            let result: SSRResponseResult<TData>;
            if (remote) {
                if (!module.render.controller)
                    return new Response("Not found", {
                        status: 404,
                        headers: { "cache-control": "no-store" },
                    });
                const input = await readControllerRequest(request);
                if (!input)
                    return new Response("Invalid controller request", {
                        status: 400,
                        headers: { "cache-control": "no-store" },
                    });
                result = await module.render.controller(input, context);
            } else result = await module.render(url, context);
            request.signal.throwIfAborted();
            const headers = requestState.responseHeaders;
            if (result.headers && result.headers !== headers) {
                const supplied = new Headers(result.headers);
                for (const [key, value] of supplied)
                    if (key !== "set-cookie") headers.set(key, value);
                for (const cookie of supplied.getSetCookie()) headers.append("set-cookie", cookie);
            }
            if (remote) {
                headers.set("content-type", "application/json");
                headers.set("cache-control", "no-store");
                if (result.rewriteUrl) headers.set("content-location", result.rewriteUrl);
                const body = result.redirect
                    ? JSON.stringify({ redirect: result.redirect })
                    : result.status && result.status >= 400
                      ? JSON.stringify({
                            rejection: {
                                status: result.status,
                                message:
                                    result.status === 401
                                        ? "Authentication required"
                                        : result.status === 403
                                          ? "Access denied"
                                          : result.status === 404
                                            ? "Page not found"
                                            : "Page load failed",
                            },
                        })
                      : module.serializeServerData(result.serverData);
                return new Response(body, { headers });
            }
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
                mode === "prerender" && publicRequest && isPublicSSRResult(result, headers);
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
                          serializedData: module.serializeServerData(result.serverData),
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
            const headers = new Headers(requestState.responseHeaders);
            headers.set("content-type", "text/plain; charset=utf-8");
            headers.set("cache-control", "no-store");
            return new Response(
                request.signal.aborted ? "Execution cancelled" : "Internal Server Error",
                {
                    status: request.signal.aborted ? 499 : 500,
                    headers,
                },
            );
        }
    };
    return {
        fetch(request, bindings) {
            if (closing)
                return Promise.resolve(new Response("Application closed", { status: 503 }));
            const work = respond(request, bindings);
            active.add(work);
            void work.then(
                () => active.delete(work),
                () => active.delete(work),
            );
            return work;
        },
        dispose: () =>
            (closing ??= (async () => {
                while (active.size) await Promise.allSettled(active);
                const results = await Promise.allSettled(
                    [...owners].map(async (render) => {
                        await render.dispose?.();
                    }),
                );
                owners.clear();
                const errors = results
                    .filter((result) => result.status === "rejected")
                    .map((result) => result.reason);
                if (errors.length) throw new AggregateError(errors, "SSR cleanup failed");
            })()),
    };
}

async function readControllerRequest(
    request: Request,
): Promise<ServerControllerRequest | undefined> {
    const reader = request.body?.getReader();
    if (!reader) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 64 * 1024) {
                await reader.cancel();
                return;
            }
            chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
        }
        const value = JSON.parse(new TextDecoder().decode(bytes));
        const record = (item: unknown) =>
            item !== null && typeof item === "object" && !Array.isArray(item);
        if (
            !record(value) ||
            typeof value.intent !== "string" ||
            !value.intent ||
            typeof value.url !== "string" ||
            !record(value.params) ||
            !record(value.query)
        )
            return;
        if (
            value.url &&
            (!value.url.startsWith("/") ||
                new URL(value.url, request.url).origin !== new URL(request.url).origin)
        )
            return;
        return { intent: value.intent, params: value.params, query: value.query, url: value.url };
    } catch {
        return;
    } finally {
        reader.releaseLock();
    }
}
