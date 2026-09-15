import { expect, test } from "vite-plus/test";
import { nodeDnsLookup } from "../../src/node/dns";
import { secureFetch, HostGuardError } from "../../../core/src/index";

test("Node resolver uses the OS localhost mapping and protected fetch refuses it", async () => {
    const addresses = await nodeDnsLookup("localhost");
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses.every((address) => address === "::1" || address.startsWith("127."))).toBe(
        true,
    );
    let calls = 0;
    const safe = secureFetch(
        async () => {
            calls++;
            return new Response("unexpected");
        },
        { lookup: nodeDnsLookup },
    );
    await expect(safe("http://localhost/")).rejects.toBeInstanceOf(HostGuardError);
    expect(calls).toBe(0);
});
