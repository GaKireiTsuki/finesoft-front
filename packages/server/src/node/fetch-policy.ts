import { isIP, type LookupFunction } from "node:net";
import { classifyHost, HostGuardError, type SecureFetchOptions } from "@finesoft/core";
import { nodeDnsLookup } from "./dns";

// One lazy process-wide pool, like Node's default fetch pool. The protected
// pool never shares connections with raw fetch or caller-supplied dispatchers.
let dispatcher: Promise<import("undici").Agent> | undefined;
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
    void nodeDnsLookup(hostname)
        .then((addresses) => {
            const records = addresses.map((address) => {
                const family = isIP(address);
                const verdict = classifyHost(address);
                if (!family || !verdict.ok)
                    throw new HostGuardError(
                        hostname,
                        `host resolves to forbidden address ${address}`,
                    );
                return { address, family };
            });
            const selected = options.family
                ? records.filter((record) => record.family === options.family)
                : records;
            if (!selected.length)
                throw new HostGuardError(hostname, "DNS lookup returned no addresses");
            // These exact validated addresses go to net/tls.connect, never a second lookup.
            if (options.all) callback(null, selected);
            else callback(null, selected[0].address, selected[0].family);
        })
        .catch((error: Error) => callback(error, "", 0));
};

/** Node fetch policy: validate DNS at socket creation, retaining hostname/TLS SNI. */
export const nodeSafeFetchOptions: SecureFetchOptions = Object.freeze({
    validateDns: false,
    wrapFetch:
        (baseFetch: typeof globalThis.fetch): typeof globalThis.fetch =>
        async (input, init) => {
            const url = typeof input === "object" && "url" in input ? input.url : String(input);
            // Relative application requests are handled by the injected in-process host.
            if (!URL.canParse(url)) return baseFetch(input, init);
            const agent = await (dispatcher ??= import("undici").then(
                ({ Agent }) => new Agent({ connect: { lookup: guardedLookup } }),
            ));
            const options: RequestInit & { dispatcher: typeof agent } = {
                ...init,
                dispatcher: agent,
            };
            return baseFetch(input, options);
        },
});
