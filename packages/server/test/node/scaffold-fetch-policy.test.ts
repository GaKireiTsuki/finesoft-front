import { createServer } from "node:http";
import type { LookupFunction } from "node:net";
import { Agent } from "undici";
import { readFileSync } from "node:fs";
import { expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/front", async () => import("../../../core/src/index.ts"));
const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup }));

import { ApiClient } from "../../../../templates/react/src/lib/services/api-client";
import { nodeSafeFetchOptions } from "../../src/node/fetch-policy";

test("scaffold preserves the Node socket guard and explicit trusted-host opt-out", async () => {
    let hits = 0;
    const server = createServer((_request, response) => {
        hits++;
        response.end("[]");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No listener");
    const rawLookup: LookupFunction = (_host, options, callback) =>
        options.all
            ? callback(null, [{ address: "127.0.0.1", family: 4 }])
            : callback(null, "127.0.0.1", 4);
    const rawAgent = new Agent({ connect: { lookup: rawLookup } });
    const transport = vi.fn<typeof fetch>((input, init) =>
        globalThis.fetch(input, { dispatcher: rawAgent, ...init } as RequestInit),
    );
    lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const config = {
        baseUrl: `http://scaffold.test:${address.port}`,
        fetch: transport,
        ...nodeSafeFetchOptions,
    };
    try {
        await expect(new ApiClient(config).getProducts()).rejects.toMatchObject({
            cause: { name: "HostGuardError" },
        });
        expect(hits).toBe(0);
        expect(transport.mock.calls[0][1]).toHaveProperty("dispatcher");
        expect(await new ApiClient({ ...config, allowInternalHosts: true }).getProducts()).toEqual(
            [],
        );
        expect(hits).toBe(1);
    } finally {
        await rawAgent.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});

test("scaffold forwards context, interceptors and headers and synchronizes all full templates", async () => {
    const signal = new AbortController().signal;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json([]));
    const responseInterceptor = vi.fn((response) => response);
    const client = new ApiClient({
        context: { fetch, signal },
        defaultHeaders: { "x-custom": "kept" },
        requestInterceptors: [
            (_url, init) => {
                const headers = new Headers(init.headers);
                headers.set("x-intercept", "yes");
                return { ...init, headers };
            },
        ],
        responseInterceptors: [responseInterceptor],
    });
    expect(await client.getProducts()).toEqual([]);
    expect(fetch.mock.calls[0][0]).toBe("/api/products");
    expect(fetch.mock.calls[0][1]?.signal).toBe(signal);
    expect(Object.fromEntries(new Headers(fetch.mock.calls[0][1]?.headers))).toMatchObject({
        "content-type": "application/json",
        "x-custom": "kept",
        "x-intercept": "yes",
    });
    expect(responseInterceptor).toHaveBeenCalledOnce();
    const source = readFileSync(
        new URL("../../../../templates/react/src/lib/services/api-client.ts", import.meta.url),
        "utf8",
    );
    for (const renderer of ["vue", "svelte"]) {
        expect(
            readFileSync(
                new URL(
                    `../../../../templates/${renderer}/src/lib/services/api-client.ts`,
                    import.meta.url,
                ),
                "utf8",
            ),
        ).toBe(source);
    }
});
