/**
 * secureFetch — `fetch` with SSRF defense baked in.
 *
 * Wraps an existing fetch implementation and refuses targets that resolve to
 * private / loopback / reserved ranges. Use when your controller fetches a
 * URL that the user can influence (image proxies, link previews, callbacks).
 *
 * Defaults to checking IP literals (sync) AND resolving hostnames via DNS
 * (requires an injected lookup; browsers explicitly select validateDns: false). Pass `allowInternalHosts: true`
 * to opt out — for example, when you have a legitimate server-to-server call
 * to 10.x or 127.0.0.1 and you trust the URL source.
 *
 * @example
 * ```ts
 * import { BaseController, DEP_KEYS, type ControllerInput } from "@finesoft/front";
 *
 * class ShareController extends BaseController<ControllerInput<{ next?: string }>, Page> {
 *     async execute({ params, context }: ControllerInput<{ next?: string }>) {
 *         // The host configures SAFE_FETCH with a DNS lookup or an explicit supported policy.
 *         const fetch = await context.get(DEP_KEYS.SAFE_FETCH);
 *         const response = await fetch(params.next ?? "https://example.com");
 *         ...
 *     }
 * }
 * ```
 */

import { enforceHostGuard, type DnsLookup } from "./target-guard";
import { fetchWithRedirects } from "./redirect-fetch";

export interface SecureFetchOptions {
    /** Opt out of SSRF defense entirely (default false). */
    allowInternalHosts?: boolean;
    /** DNS-resolve hostnames and check each resolved IP (default true). */
    validateDns?: boolean;
    /** Required when DNS validation is enabled for a hostname. */
    lookup?: DnsLookup;
    /** Host transport enforcing policy at connection time; preserves the injected fetch. */
    wrapFetch?: (baseFetch: typeof globalThis.fetch) => typeof globalThis.fetch;
}

/**
 * Return a `fetch`-shaped function that refuses requests to private hosts
 * before each request. DNS preflight alone cannot pin an arbitrary transport;
 * select a host connection policy when DNS rebinding protection is required.
 */
export function secureFetch(
    baseFetch: typeof globalThis.fetch,
    options: SecureFetchOptions = {},
): typeof globalThis.fetch {
    const allowInternalHosts = options.allowInternalHosts ?? false;
    if (allowInternalHosts) return baseFetch;
    const fetch = options.wrapFetch?.(baseFetch) ?? baseFetch;
    return (input, init) =>
        fetchWithRedirects(fetch, input, init, (url) => enforceHostGuard(url, options));
}
