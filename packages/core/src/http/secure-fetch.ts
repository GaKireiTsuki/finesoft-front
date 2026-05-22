/**
 * secureFetch — `fetch` with SSRF defense baked in.
 *
 * Wraps an existing fetch implementation and refuses targets that resolve to
 * private / loopback / reserved ranges. Use when your controller fetches a
 * URL that the user can influence (image proxies, link previews, callbacks).
 *
 * Defaults to checking IP literals (sync) AND resolving hostnames via DNS
 * (Node only; silently skipped in browsers). Pass `allowInternalHosts: true`
 * to opt out — for example, when you have a legitimate server-to-server call
 * to 10.x or 127.0.0.1 and you trust the URL source.
 *
 * @example
 * ```ts
 * import { secureFetch, DEP_KEYS } from "@finesoft/front";
 *
 * class ShareController extends BaseController<{ next?: string }, Page> {
 *     async execute(params, container) {
 *         const baseFetch = container.resolve<typeof globalThis.fetch>(DEP_KEYS.FETCH);
 *         const fetch = secureFetch(baseFetch);
 *         const response = await fetch(params.next ?? "https://example.com");
 *         ...
 *     }
 * }
 * ```
 */

import { classifyUrl } from "./host-guard";
import { HostGuardError } from "./client";

export interface SecureFetchOptions {
    /** Opt out of SSRF defense entirely (default false). */
    allowInternalHosts?: boolean;
    /** DNS-resolve hostnames and check each resolved IP (default true, Node only). */
    validateDns?: boolean;
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
        input: RequestInfo | URL,
        init?: RequestInit,
    ): Promise<Response> {
        if (!allowInternalHosts) {
            const url = extractUrl(input);
            // Only inspect absolute URLs (anything `new URL(url)` can parse on its own).
            // Relative URLs go through unchecked — they're same-origin, the SOP / CSP
            // handle that case. `file:`, `gopher:`, `data:` etc. ARE absolute and will
            // be rejected by classifyUrl's scheme check.
            if (url && isAbsoluteUrl(url)) {
                const verdict = classifyUrl(url);
                if (!verdict.ok) {
                    throw new HostGuardError(url, verdict.reason);
                }
                if (validateDns) {
                    const parsed = new URL(url);
                    if (parsed.hostname && !isIpLiteral(parsed.hostname)) {
                        const dnsVerdict = await resolveAndClassify(parsed.hostname);
                        if (!dnsVerdict.ok) {
                            throw new HostGuardError(url, dnsVerdict.reason);
                        }
                    }
                }
            }
        }
        return baseFetch(input, init);
    };
}

function isAbsoluteUrl(s: string): boolean {
    try {
        new URL(s);
        return true;
    } catch {
        return false;
    }
}

function extractUrl(input: RequestInfo | URL): string | null {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    if (typeof Request !== "undefined" && input instanceof Request) return input.url;
    return null;
}

function isIpLiteral(host: string): boolean {
    if (host.includes(":")) return true;
    return /^[0-9.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host);
}

interface NodeDns {
    resolve4(hostname: string): Promise<string[]>;
    resolve6(hostname: string): Promise<string[]>;
}

async function resolveAndClassify(
    hostname: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
    let dns: NodeDns;
    try {
        const specifier = "node:dns/promises";
        const mod = (await import(specifier)) as { default?: NodeDns } & NodeDns;
        dns = mod.default ?? mod;
    } catch {
        return { ok: true };
    }
    const settled = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);
    const addrs: string[] = [];
    for (const r of settled) if (r.status === "fulfilled") addrs.push(...r.value);
    if (addrs.length === 0) return { ok: true };
    for (const ip of addrs) {
        const verdict = classifyUrl(`http://${ip.includes(":") ? `[${ip}]` : ip}/`);
        if (!verdict.ok) {
            return { ok: false, reason: `host resolves to ${ip} (${verdict.reason})` };
        }
    }
    return { ok: true };
}
