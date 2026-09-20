import { describe, expect, test, vi } from "vite-plus/test";
import { secureFetch } from "../../src/http/secure-fetch";
import { HttpClient, HostGuardError } from "../../src/http/client";

function redirect(location: string, status = 302) {
    return new Response(null, { status, headers: { location } });
}

describe("protected redirect boundary", () => {
    test.each([
        "http://127.0.0.1/secret",
        "http://2130706433/secret",
        "http://[::ffff:7f00:1]/secret",
        "//169.254.169.254/latest",
        "http://10.0.0.1/secret",
    ])("blocks a public redirect to %s before the second request", async (location) => {
        const fetch = vi.fn<typeof globalThis.fetch>(async () => redirect(location));
        await expect(
            secureFetch(fetch, { validateDns: false })("https://public.test"),
        ).rejects.toBeInstanceOf(HostGuardError);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][1]).toEqual({ redirect: "manual" });
    });

    test.each(["//127.0.0.1/x", "/\\127.0.0.1/x", "\\\\127.0.0.1/x"])(
        "guards network-path input %s",
        async (input) => {
            const fetch = vi.fn();
            await expect(secureFetch(fetch, { validateDns: false })(input)).rejects.toBeInstanceOf(
                HostGuardError,
            );
            expect(fetch).not.toHaveBeenCalled();
        },
    );

    test("rechecks DNS at each redirect destination", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(async () => redirect("https://private.test"));
        const lookup = vi.fn(async (hostname: string) =>
            hostname === "public.test" ? ["1.1.1.1"] : ["192.168.1.1"],
        );
        await expect(
            secureFetch(fetch, { lookup })(new URL("https://public.test")),
        ).rejects.toBeInstanceOf(HostGuardError);
        expect(lookup.mock.calls.map(([host]) => host)).toEqual(["public.test", "private.test"]);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    test("follows public redirects, converts POST and strips cross-origin credentials", async () => {
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockResolvedValueOnce(redirect("https://other.test/final", 302))
            .mockResolvedValueOnce(new Response("ok"));
        const response = await secureFetch(fetch, { validateDns: false })(
            "https://public.test/start",
            {
                method: "POST",
                body: "payload",
                headers: {
                    authorization: "secret",
                    cookie: "private=1",
                    "proxy-authorization": "proxy",
                    host: "public.test",
                    "content-type": "text/plain",
                    "content-length": "7",
                    "x-public": "keep",
                },
            },
        );
        const [url, init] = fetch.mock.calls[1];
        expect(url).toBe("https://other.test/final");
        expect(init?.method).toBe("GET");
        expect(init?.body).toBeUndefined();
        expect(Object.fromEntries(new Headers(init?.headers))).toEqual({ "x-public": "keep" });
        expect(response.redirected).toBe(true);
        expect(await response.text()).toBe("ok");
    });

    test.each([307, 308])(
        "preserves replayable bodies and same-origin credentials for %s",
        async (status) => {
            const fetch = vi
                .fn<typeof globalThis.fetch>()
                .mockResolvedValueOnce(redirect("/next", status))
                .mockResolvedValueOnce(new Response("ok"));
            const signal = new AbortController().signal;
            await secureFetch(fetch, { validateDns: false })("https://public.test/start", {
                method: "PUT",
                body: "bytes",
                headers: { authorization: "secret" },
                signal,
            });
            expect(fetch.mock.calls[1][0]).toBe("https://public.test/next");
            expect(fetch.mock.calls[1][1]).toMatchObject({ method: "PUT", body: "bytes", signal });
            expect(new Headers(fetch.mock.calls[1][1]?.headers).get("authorization")).toBe(
                "secret",
            );
        },
    );

    test("Request metadata and init redirect precedence survive a 303", async () => {
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockResolvedValueOnce(redirect("/next", 303))
            .mockResolvedValueOnce(new Response("ok"));
        const request = new Request("https://public.test/start", {
            method: "POST",
            body: "body",
            redirect: "error",
            credentials: "omit",
            headers: { "x-custom": "value" },
        });
        await secureFetch(fetch, { validateDns: false })(request, { redirect: "follow" });
        expect(fetch.mock.calls[1][1]).toMatchObject({
            method: "GET",
            body: undefined,
            credentials: "omit",
            signal: request.signal,
        });
        expect(new Headers(fetch.mock.calls[1][1]?.headers).get("x-custom")).toBe("value");
    });

    test.each(["manual", "error"] as const)("preserves explicit %s mode", async (mode) => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(redirect("/next"));
        await secureFetch(fetch, { validateDns: false })(
            new Request("https://public.test", { redirect: mode }),
        );
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][1]?.redirect).toBe(mode);
    });

    test("relative application redirects remain in the injected host", async () => {
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockResolvedValueOnce(redirect("../next"))
            .mockResolvedValueOnce(new Response("ok"));
        await secureFetch(fetch)("/api/start");
        expect(fetch.mock.calls[1][0]).toBe("/next");
    });

    test("cancels intermediate bodies and bounds cycles", async () => {
        const cancel = vi.fn();
        const fetch = vi.fn<typeof globalThis.fetch>(
            async () =>
                new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }), {
                    status: 302,
                    headers: { location: "/again" },
                }),
        );
        await expect(
            secureFetch(fetch, { validateDns: false })("https://public.test"),
        ).rejects.toThrow("Too many redirects");
        expect(fetch).toHaveBeenCalledTimes(21);
        expect(cancel).toHaveBeenCalledTimes(21);
    });

    test("rejects opaque redirects and consumed stream replay", async () => {
        const opaque = new Response();
        Object.defineProperty(opaque, "type", { value: "opaqueredirect" });
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockResolvedValueOnce(opaque)
            .mockResolvedValueOnce(redirect("/next", 307));
        const safe = secureFetch(fetch, { validateDns: false });
        await expect(safe("https://public.test")).rejects.toThrow("opaque redirect");
        await expect(
            safe(new Request("https://public.test", { method: "POST", body: "body" })),
        ).rejects.toThrow("streamed request body");
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    test("abort during a redirect prevents the next request", async () => {
        const abort = new AbortController();
        const cancel = vi.fn();
        const fetch = vi.fn<typeof globalThis.fetch>(async () => {
            abort.abort();
            return new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }), {
                status: 302,
                headers: { location: "/next" },
            });
        });
        await expect(
            secureFetch(fetch, { validateDns: false })("https://public.test", {
                signal: abort.signal,
            }),
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    test("HttpClient shares redirect protection after request interceptors", async () => {
        class Client extends HttpClient {
            load() {
                return this.get("/start");
            }
        }
        const fetch = vi.fn<typeof globalThis.fetch>(async () => redirect("http://127.0.0.1/"));
        const client = new Client({
            baseUrl: "https://public.test",
            fetch,
            validateDns: false,
            requestInterceptors: [(_url, init) => ({ ...init, redirect: "follow" })],
        });
        await expect(client.load()).rejects.toBeInstanceOf(HostGuardError);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
