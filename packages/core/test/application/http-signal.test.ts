import { expect, test, vi } from "vite-plus/test";
import { HttpClient } from "../../src/index";
class Client extends HttpClient {
    read(signal: AbortSignal) {
        return this.get("/data", undefined, { signal });
    }
    write(signal: AbortSignal) {
        return this.post("/data", {}, undefined, { signal });
    }
}
test("HTTP convenience calls preserve abort through interceptors and host checks", async () => {
    const fetch = vi.fn(async (_: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
        init?.signal?.throwIfAborted();
        return new Response("{}");
    });
    const controller = new AbortController();
    const client = new Client({
        baseUrl: "https://example.com",
        fetch,
        validateDns: false,
        requestInterceptors: [() => ({ headers: {} })],
    });
    await client.read(controller.signal);
    expect(fetch.mock.calls[0][1]?.signal).toBe(controller.signal);
    controller.abort();
    await expect(client.write(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(1);
});

test("execution-owned HTTP clients keep context cancellation after interceptor replacement", async () => {
    const owner = new AbortController();
    const local = new AbortController();
    const fetch = vi.fn(
        async (_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
            expect(init?.signal).not.toBe(local.signal);
            owner.abort();
            init?.signal?.throwIfAborted();
            return new Response("{}");
        },
    );
    const client = new Client({
        baseUrl: "https://example.com",
        context: { fetch, signal: owner.signal },
        validateDns: false,
        requestInterceptors: [() => ({ headers: {}, signal: new AbortController().signal })],
    });
    await expect(client.read(local.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledOnce();
});
