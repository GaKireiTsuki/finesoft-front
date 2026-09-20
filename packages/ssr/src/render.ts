import type { SecureFetchOptions } from "@finesoft/core";
import type { WebHydration } from "@finesoft/web";

export interface SSRContext {
    identity?: string;
    traceId?: string;
    safeFetch?: SecureFetchOptions;
    fetch?: typeof globalThis.fetch;
    request?: Request;
    bindings?: Readonly<Record<string, unknown>>;
}
export interface SSRAppResult {
    html: string;
    head?: string;
    css?: string;
    slots?: Record<string, string>;
}
export interface SSRRenderResult {
    headers?: HeadersInit;
    cache?: "public";
    html: string;
    head: string;
    css: string;
    serverData: WebHydration;
    renderMode?: string;
    redirect?: { url: string; status: number };
    slots?: Record<string, string>;
    locale?: { lang: string; dir: string };
    status?: number;
    rewriteUrl?: string;
}
