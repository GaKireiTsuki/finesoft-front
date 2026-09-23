import { createServer } from "node:http";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { secureFetch } from "@finesoft/core";
import { guardedLookup, nodeSafeFetchOptions } from "../../src/node/fetch-policy";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup }));
afterEach(() => lookup.mockReset());

test("connection lookup passes the exact checked DNS records without a second resolution", async () => {
    lookup.mockResolvedValue([
        { address: "1.1.1.1", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
    ]);
    const callback = vi.fn();
    guardedLookup("public.test", { all: true }, callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalled());
    expect(callback).toHaveBeenCalledWith(null, [
        { address: "1.1.1.1", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
    ]);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("public.test", { all: true });
});

test.each([
    "127.0.0.1",
    "::ffff:127.0.0.1",
    "169.254.169.254",
    "10.0.0.1",
    "198.18.0.0",
    "198.19.255.255",
    "::ffff:c612:1",
])("rejects %s from mixed connection DNS answers", async (address) => {
    lookup.mockResolvedValue([
        { address: "1.1.1.1", family: 4 },
        { address, family: address.includes(":") ? 6 : 4 },
    ]);
    const callback = vi.fn();
    guardedLookup("rebind.test", { all: true }, callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalled());
    expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ name: "HostGuardError" }),
        "",
        0,
    );
});

test("real Node fetch refuses the connection after a public preflight turns private", async () => {
    let hits = 0;
    const server = createServer((_request, response) => {
        hits++;
        response.end("internal");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No listener");
    try {
        lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
        const preflight = vi.fn(async () => ["1.1.1.1"]);
        const safe = secureFetch(globalThis.fetch, {
            ...nodeSafeFetchOptions,
            validateDns: true,
            lookup: preflight,
        });
        await expect(
            safe(`http://rebind.test:${address.port}/`, { signal: AbortSignal.timeout(2000) }),
        ).rejects.toMatchObject({ cause: { name: "HostGuardError" } });
        expect(preflight).toHaveBeenCalledTimes(1);
        expect(lookup).toHaveBeenCalledTimes(1);
        expect(hits).toBe(0);
        const trusted = secureFetch(globalThis.fetch, {
            ...nodeSafeFetchOptions,
            allowInternalHosts: true,
        });
        expect(await (await trusted(`http://127.0.0.1:${address.port}/`)).text()).toBe("internal");
        expect(hits).toBe(1);
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    }
});

test("Node policy keeps the injected fetch and overrides unsafe dispatchers", async () => {
    const base = vi.fn<typeof globalThis.fetch>(async () => new Response("ok"));
    const safe = secureFetch(base, nodeSafeFetchOptions);
    const unsafeDispatcher = {};
    const supplied: RequestInit & { dispatcher: object } = { dispatcher: unsafeDispatcher };
    await safe(new Request("https://public.test", { headers: { "x-custom": "keep" } }), supplied);
    expect(base).toHaveBeenCalledTimes(1);
    const [request, init] = base.mock.calls[0];
    expect((request as Request).url).toBe("https://public.test/");
    expect((request as Request).headers.get("x-custom")).toBe("keep");
    expect(init).toHaveProperty("dispatcher");
    expect((init as typeof supplied).dispatcher).not.toBe(unsafeDispatcher);
    expect(init?.redirect).toBe("manual");
});
