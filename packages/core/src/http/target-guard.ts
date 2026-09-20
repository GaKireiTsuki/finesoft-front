import { classifyUrl } from "./host-guard";
import { HostGuardError } from "./errors";

/** Host adapter lookup, returning every address used by its resolver. */
export type DnsLookup = (hostname: string) => Promise<readonly string[]>;

export interface TargetGuardOptions {
    readonly validateDns?: boolean;
    readonly lookup?: DnsLookup;
}

/** Shared target policy for HttpClient and secureFetch. */
export async function enforceHostGuard(
    url: string,
    options: TargetGuardOptions = {},
): Promise<void> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        // True relative URLs stay with the injected host. Network-path and
        // backslash variants can select a different host in the URL parser.
        parsed = new URL(url, "http://relative.invalid/");
        if (parsed.origin === "http://relative.invalid") return;
    }
    const verdict = classifyUrl(parsed.href);
    if (!verdict.ok) throw new HostGuardError(url, verdict.reason);
    if (
        options.validateDns === false ||
        parsed.hostname.includes(":") ||
        /^[0-9.]+$/.test(parsed.hostname)
    )
        return;
    if (!options.lookup) throw new HostGuardError(url, "DNS lookup capability is required");
    let addresses: readonly string[];
    try {
        addresses = await options.lookup(parsed.hostname);
    } catch {
        throw new HostGuardError(url, "DNS lookup failed");
    }
    if (addresses.length === 0) throw new HostGuardError(url, "DNS lookup returned no addresses");
    for (const address of addresses) {
        const result = classifyUrl(`http://${address.includes(":") ? `[${address}]` : address}/`);
        if (!result.ok)
            throw new HostGuardError(url, `host resolves to ${address} (${result.reason})`);
    }
}
