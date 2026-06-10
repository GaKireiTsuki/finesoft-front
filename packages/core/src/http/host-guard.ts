/**
 * host-guard — refuse outbound requests to private / loopback / reserved hosts.
 *
 * Why this exists: `HttpClient` and the raw `fetch` injected via DI both used
 * to accept any URL the application built. SSR controllers that take a
 * user-controlled URL (image proxy, link preview, OAuth callback) could be
 * tricked into fetching `http://127.0.0.1/admin` and embedding the response in
 * the SSR HTML. Round 1 of the adversarial drill walked straight through this;
 * round 2's hand-rolled IPv4 regex was bypassed in five minutes with
 * `[::ffff:7f00:1]`. This module centralises the check so applications can stop
 * re-implementing it (badly).
 *
 * Coverage (synchronous, IP-literal forms):
 * - IPv4 dotted-decimal: `127.0.0.1`, `10.0.0.5`, `192.168.1.1`, `172.16.0.1`
 * - IPv4 zero / link-local / multicast / reserved: `0.0.0.0`, `169.254.0.1`,
 *   `224.0.0.1`, `240.0.0.0/4`
 * - IPv4 non-dotted forms accepted by some parsers: decimal `2130706433`,
 *   hex `0x7f000001`, octal `0177.0.0.1`
 * - IPv6 loopback `::1`, link-local `fe80::/10`, ULA `fc00::/7`, unspecified `::`
 * - IPv4-mapped IPv6: `::ffff:7f00:1`, `::ffff:127.0.0.1`
 * - Names: `localhost`, `*.localhost`
 *
 * NOT covered here (callers can layer on top):
 * - DNS resolution of arbitrary hostnames — see `validateUrlWithDns` in
 *   server-only callers. DNS rebinding is impossible to fix at this layer
 *   alone; the right pattern is "resolve once, then fetch by IP".
 * - IDN / homograph attacks — Node's URL parser punycode-encodes hostnames
 *   already, so the hostname this code sees is the ASCII form.
 */

export type HostCheckResult = { ok: true } | { ok: false; reason: string };

/**
 * Inspect a hostname string (the `URL.hostname` value, without brackets, port,
 * or userinfo). Returns `{ok: false}` for anything in a private/loopback/
 * reserved range; `{ok: true}` if the literal looks like a public address or a
 * non-IP name (the caller may then DNS-resolve and re-check).
 */
export function classifyHost(rawHost: string): HostCheckResult {
    if (!rawHost) return { ok: false, reason: "empty host" };
    const host = rawHost.toLowerCase();

    // Strip a single pair of IPv6 brackets just in case the caller forgot.
    const stripped = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

    // Names. We only special-case the well-known loopback alias; arbitrary
    // hostnames require DNS resolution to classify (out of scope here).
    if (stripped === "localhost" || stripped.endsWith(".localhost")) {
        return { ok: false, reason: "loopback host forbidden" };
    }

    // IPv6 first — anything containing a colon is treated as IPv6.
    if (stripped.includes(":")) return classifyIPv6(stripped);

    // IPv4-ish: dotted, decimal, hex, octal.
    const v4 = parseIPv4Loose(stripped);
    if (v4) return classifyIPv4Octets(v4);

    // Not an IP literal; defer to caller (likely DNS) for hostnames.
    return { ok: true };
}

/**
 * Convenience wrapper for callers holding a full URL string. Also rejects
 * non-http(s) schemes (gopher, file, data, …).
 */
export function classifyUrl(rawUrl: string): HostCheckResult {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return { ok: false, reason: "invalid URL" };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { ok: false, reason: `scheme "${url.protocol}" not allowed (only http/https)` };
    }
    return classifyHost(url.hostname);
}

// ──────────────────── IPv4 ────────────────────

/**
 * Parse an IPv4 host in the various forms web platforms historically accept:
 *
 * - "127.0.0.1"          (dotted decimal, the only RFC-correct form)
 * - "2130706433"         (one big decimal — equals 0x7F000001)
 * - "0x7f000001"         (one big hex)
 * - "0177.0.0.1"         (per-octet octal, leading 0)
 * - "0xff.0xff.0xff.0xff" (per-octet hex)
 *
 * Returns the 4 octets if parseable, else null. We do NOT mark these as
 * "invalid host" — bypass attempts via decimal/hex/octal are valid IP literals
 * and Node's fetch will resolve them. We just need their octets to check
 * against private ranges.
 */
function parseIPv4Loose(host: string): [number, number, number, number] | null {
    if (host.length === 0) return null;

    // Single integer (decimal or 0x-prefixed hex).
    if (!host.includes(".")) {
        const n = parsePartLoose(host);
        if (n === null || n < 0 || n > 0xffffffff) return null;
        return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    }

    const parts = host.split(".");
    if (parts.length !== 4) return null;
    const out: number[] = [];
    for (const part of parts) {
        const n = parsePartLoose(part);
        if (n === null || n < 0 || n > 0xff) return null;
        out.push(n);
    }
    return out as [number, number, number, number];
}

function parsePartLoose(part: string): number | null {
    if (part.length === 0) return null;
    // Hex
    if (part.startsWith("0x") || part.startsWith("0X")) {
        const hex = part.slice(2);
        if (!/^[0-9a-f]+$/i.test(hex)) return null;
        return parseInt(hex, 16);
    }
    // Octal (leading 0, not just "0" itself)
    if (part.length > 1 && part.startsWith("0")) {
        if (!/^[0-7]+$/.test(part)) return null;
        return parseInt(part, 8);
    }
    // Decimal
    if (!/^[0-9]+$/.test(part)) return null;
    return parseInt(part, 10);
}

function classifyIPv4Octets(o: [number, number, number, number]): HostCheckResult {
    const [a, b] = o;
    // 0.0.0.0/8 — current network
    if (a === 0) return { ok: false, reason: "unspecified IPv4 forbidden" };
    // 127.0.0.0/8 — loopback
    if (a === 127) return { ok: false, reason: "loopback IPv4 forbidden" };
    // 10.0.0.0/8 — RFC1918
    if (a === 10) return { ok: false, reason: "private IPv4 (10/8) forbidden" };
    // 172.16.0.0/12 — RFC1918
    if (a === 172 && b >= 16 && b <= 31) {
        return { ok: false, reason: "private IPv4 (172.16/12) forbidden" };
    }
    // 192.168.0.0/16 — RFC1918
    if (a === 192 && b === 168) {
        return { ok: false, reason: "private IPv4 (192.168/16) forbidden" };
    }
    // 169.254.0.0/16 — link-local (incl. AWS metadata 169.254.169.254)
    if (a === 169 && b === 254) {
        return { ok: false, reason: "link-local IPv4 forbidden" };
    }
    // 100.64.0.0/10 — carrier-grade NAT
    if (a === 100 && b >= 64 && b <= 127) {
        return { ok: false, reason: "CGNAT IPv4 forbidden" };
    }
    // 224.0.0.0/4 — multicast
    if (a >= 224 && a <= 239) return { ok: false, reason: "multicast IPv4 forbidden" };
    // 240.0.0.0/4 — reserved
    if (a >= 240) return { ok: false, reason: "reserved IPv4 forbidden" };
    return { ok: true };
}

// ──────────────────── IPv6 ────────────────────

/**
 * Best-effort IPv6 classification. We only need to recognise loopback,
 * link-local, ULA, and IPv4-mapped/-compatible forms; we don't need to
 * canonicalise arbitrary IPv6.
 */
function classifyIPv6(host: string): HostCheckResult {
    const lower = host.toLowerCase();

    // ::0 unspecified
    if (lower === "::" || lower === "::0")
        return { ok: false, reason: "unspecified IPv6 forbidden" };
    // ::1 loopback
    if (lower === "::1") return { ok: false, reason: "loopback IPv6 forbidden" };
    // fe80::/10 link-local
    if (
        lower.startsWith("fe8") ||
        lower.startsWith("fe9") ||
        lower.startsWith("fea") ||
        lower.startsWith("feb")
    ) {
        return { ok: false, reason: "link-local IPv6 forbidden" };
    }
    // fc00::/7 ULA — fc00::/8 and fd00::/8
    if (lower.startsWith("fc") || lower.startsWith("fd")) {
        return { ok: false, reason: "ULA IPv6 forbidden" };
    }
    // ff00::/8 multicast
    if (lower.startsWith("ff")) return { ok: false, reason: "multicast IPv6 forbidden" };

    // IPv4-mapped/-compatible: ::ffff:x.x.x.x or ::ffff:HHHH:HHHH or ::HHHH:HHHH
    const v4 = extractIPv4FromIPv6(lower);
    if (v4) {
        const verdict = classifyIPv4Octets(v4);
        if (!verdict.ok) {
            return { ok: false, reason: `IPv4-in-IPv6 ${verdict.reason}` };
        }
    }

    return { ok: true };
}

function extractIPv4FromIPv6(lower: string): [number, number, number, number] | null {
    // ::ffff:127.0.0.1 / ::127.0.0.1 / 0:0:0:0:0:ffff:127.0.0.1
    const dottedMatch = lower.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
    if (dottedMatch) {
        const v4 = parseIPv4Loose(dottedMatch[1]);
        if (v4) return v4;
    }
    // ::ffff:7f00:1 — last two 16-bit groups encode the v4 address
    const hexMatch = lower.match(/(?:^|:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMatch && (lower.startsWith("::ffff:") || lower.includes(":ffff:"))) {
        const hi = parseInt(hexMatch[1], 16);
        const lo = parseInt(hexMatch[2], 16);
        return [(hi >>> 8) & 0xff, hi & 0xff, (lo >>> 8) & 0xff, lo & 0xff];
    }
    return null;
}
