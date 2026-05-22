import { describe, expect, test, vi } from "vite-plus/test";
import { HostGuardError, HttpClient } from "../../src/http/client";

class TestClient extends HttpClient {
    fetchAt(path: string): Promise<unknown> {
        return this.get(path);
    }
}

function fakeFetch(): typeof globalThis.fetch {
    return vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 })) as any;
}

describe("HttpClient SSRF defense", () => {
    test("default allowInternalHosts=false blocks loopback baseUrl", async () => {
        const f = fakeFetch();
        const client = new TestClient({
            baseUrl: "http://127.0.0.1:9999",
            fetch: f,
            validateDns: false,
        });

        await expect(client.fetchAt("/")).rejects.toBeInstanceOf(HostGuardError);
        expect(f).not.toHaveBeenCalled();
    });

    test("allowInternalHosts=true opts out", async () => {
        const f = fakeFetch();
        const client = new TestClient({
            baseUrl: "http://127.0.0.1:9999",
            fetch: f,
            allowInternalHosts: true,
        });

        const res = await client.fetchAt("/");
        expect(res).toEqual({ ok: 1 });
        expect(f).toHaveBeenCalledTimes(1);
    });

    test("relative baseUrl is not host-checked (it's same-origin)", async () => {
        const f = fakeFetch();
        const client = new TestClient({ baseUrl: "/api", fetch: f, validateDns: false });

        const res = await client.fetchAt("/users");
        expect(res).toEqual({ ok: 1 });
        expect(f).toHaveBeenCalledTimes(1);
    });

    test("blocks IPv4-mapped IPv6 baseUrl", async () => {
        const f = fakeFetch();
        const client = new TestClient({
            baseUrl: "http://[::ffff:7f00:1]:9999",
            fetch: f,
            validateDns: false,
        });
        await expect(client.fetchAt("/")).rejects.toBeInstanceOf(HostGuardError);
    });

    test("public absolute baseUrl is allowed", async () => {
        const f = fakeFetch();
        const client = new TestClient({
            baseUrl: "https://1.1.1.1",
            fetch: f,
            validateDns: false,
        });
        const res = await client.fetchAt("/");
        expect(res).toEqual({ ok: 1 });
    });
});
