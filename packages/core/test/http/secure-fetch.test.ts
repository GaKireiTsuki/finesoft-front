import { describe, expect, test, vi } from "vite-plus/test";
import { HostGuardError } from "../../src/http/client";
import { secureFetch } from "../../src/http/secure-fetch";

function fakeFetch(): typeof globalThis.fetch {
    return vi.fn(async () => new Response("ok", { status: 200 })) as any;
}

describe("secureFetch", () => {
    test("blocks loopback IPv4 by default", async () => {
        const base = fakeFetch();
        const safe = secureFetch(base, { validateDns: false });

        await expect(safe("http://127.0.0.1/")).rejects.toBeInstanceOf(HostGuardError);
        expect(base).not.toHaveBeenCalled();
    });

    test("blocks IPv4-mapped IPv6 ::ffff:7f00:1", async () => {
        const base = fakeFetch();
        const safe = secureFetch(base, { validateDns: false });
        await expect(safe("http://[::ffff:7f00:1]:9999/")).rejects.toBeInstanceOf(HostGuardError);
    });

    test("blocks decimal IPv4 form 2130706433", async () => {
        const base = fakeFetch();
        const safe = secureFetch(base, { validateDns: false });
        await expect(safe("http://2130706433/")).rejects.toBeInstanceOf(HostGuardError);
    });

    test("blocks file:// scheme", async () => {
        const base = fakeFetch();
        const safe = secureFetch(base, { validateDns: false });
        await expect(safe("file:///etc/passwd")).rejects.toBeInstanceOf(HostGuardError);
    });

    test("allowInternalHosts opts out entirely", async () => {
        const base = fakeFetch();
        const safe = secureFetch(base, { allowInternalHosts: true });

        const res = await safe("http://127.0.0.1/");
        expect(res.status).toBe(200);
        expect(base).toHaveBeenCalledTimes(1);
    });

    test("passes through Request objects", async () => {
        const base = fakeFetch();
        const safe = secureFetch(base, { validateDns: false });

        await safe(new Request("https://example.com/"));
        expect(base).toHaveBeenCalledTimes(1);
    });

    test("passes through URL objects", async () => {
        const base = fakeFetch();
        const safe = secureFetch(base, { validateDns: false });

        await safe(new URL("https://example.com/"));
        expect(base).toHaveBeenCalledTimes(1);
    });

    test("error.reason names the blocked range", async () => {
        const base = fakeFetch();
        const safe = secureFetch(base, { validateDns: false });
        await expect(safe("http://192.168.1.1/")).rejects.toMatchObject({
            name: "HostGuardError",
            reason: expect.stringContaining("192.168"),
        });
    });
});

test("DNS protection requires an explicit resolver", async () => {
    const base = fakeFetch();
    await expect(secureFetch(base)("https://example.com")).rejects.toMatchObject({
        reason: expect.stringContaining("DNS lookup capability"),
    });
    expect(base).not.toHaveBeenCalled();
});

test("injected DNS checks every resolved address and fails closed", async () => {
    const base = fakeFetch();
    const lookup = vi.fn(async () => ["1.1.1.1", "127.0.0.1"]);
    await expect(secureFetch(base, { lookup })("https://example.com")).rejects.toBeInstanceOf(
        HostGuardError,
    );
    expect(lookup).toHaveBeenCalledWith("example.com");
    expect(base).not.toHaveBeenCalled();
    await expect(
        secureFetch(base, { lookup: async () => [] })("https://example.com"),
    ).rejects.toBeInstanceOf(HostGuardError);
    await expect(
        secureFetch(base, {
            lookup: async () => {
                throw new Error("DNS unavailable");
            },
        })("https://example.com"),
    ).rejects.toBeInstanceOf(HostGuardError);
});
