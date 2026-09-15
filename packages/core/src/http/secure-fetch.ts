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
 * import { DEP_KEYS } from "@finesoft/front";
 *
 * class ShareController extends BaseController<{ next?: string }, Page> {
 *     async execute(params, container) {
 *         // The host configures SAFE_FETCH with a DNS lookup or an explicit supported policy.
 *         const fetch = container.resolve<typeof globalThis.fetch>(DEP_KEYS.SAFE_FETCH);
 *         const response = await fetch(params.next ?? "https://example.com");
 *         ...
 *     }
 * }
 * ```
 */

import { enforceHostGuard, type DnsLookup } from "./target-guard";

export interface SecureFetchOptions {
    /** Opt out of SSRF defense entirely (default false). */
    allowInternalHosts?: boolean;
    /** DNS-resolve hostnames and check each resolved IP (default true). */
    validateDns?: boolean;
    /** Required when DNS validation is enabled for a hostname. */
    lookup?: DnsLookup;
}

/**
 * Return a `fetch`-shaped function that refuses requests to private hosts
 * before calling through to `baseFetch`.
 */
export function secureFetch(
    baseFetch: typeof globalThis.fetch,
    options: SecureFetchOptions = {},
): typeof globalThis.fetch {
    const allowInternalHosts = options.allowInternalHosts ?? false;
    const validateDns = options.validateDns ?? true;

    return async function secureFetchImpl(
        input: string | Request | URL,
        init?: RequestInit,
    ): Promise<Response> {
        if (!allowInternalHosts) {
            const url = extractUrl(input);
            if (url) await enforceHostGuard(url, { validateDns, lookup: options.lookup });
        }
        return baseFetch(input, init);
    };
}

function extractUrl(input: string | Request | URL): string | null {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    if ("url" in input) return input.url;
    return null;
}
