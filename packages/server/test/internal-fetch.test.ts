import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { createInternalFetch, SSR_DEPTH_HEADER } from "../src/internal-fetch";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("createInternalFetch", () => {
    test("routes relative URLs through the in-memory app fetch", async () => {
        const appFetch = vi.fn(async (request: Request) => new Response(request.method));
        const internalFetch = createInternalFetch(appFetch, 3);

        const response = await internalFetch("/api/products", {
            method: "POST",
        });
        const request = appFetch.mock.calls[0][0] as Request;

        expect(request.url).toBe("http://localhost/api/products");
        expect(request.headers.get(SSR_DEPTH_HEADER)).toBe("3");
        expect(await response.text()).toBe("POST");
    });

    test("delegates absolute URLs, URL objects, and Request objects to global fetch", async () => {
        const globalFetch = vi.fn(async () => new Response("network"));
        vi.stubGlobal("fetch", globalFetch);
        const internalFetch = createInternalFetch(vi.fn(), 2);
        const request = new Request("https://example.com/request");
        const urlObject = new URL("https://example.com/url-object");

        await internalFetch("https://example.com/absolute");
        await internalFetch(urlObject);
        await internalFetch(request);

        expect(globalFetch).toHaveBeenNthCalledWith(1, "https://example.com/absolute", undefined);
        expect(globalFetch).toHaveBeenNthCalledWith(2, urlObject, undefined);
        expect(globalFetch).toHaveBeenNthCalledWith(3, request, undefined);
    });

    test("uses only explicit request headers and leaves response handling to the caller", async () => {
        const network = vi.fn(async () => new Response("network"));
        vi.stubGlobal("fetch", network);
        const request = new Request("https://app.test/account", {
            headers: { cookie: "session=old", authorization: "Bearer scoped" },
        });
        const appFetch = vi.fn(
            async (_request: Request) =>
                new Response("ok", {
                    headers: [
                        ["set-cookie", "session=fresh; HttpOnly; Path=/"],
                        ["set-cookie", "locale=en; Path=/"],
                    ],
                }),
        );
        const internal = createInternalFetch(appFetch, 1, { request, bindings: {} });
        const response = await internal("/api/refresh");
        expect(appFetch.mock.calls[0][0].headers.has("cookie")).toBe(false);
        expect(appFetch.mock.calls[0][0].headers.has("authorization")).toBe(false);
        expect(response.headers.getSetCookie()).toHaveLength(2);
        expect(request.headers.get("cookie")).toBe("session=old");
        await internal("/api/next", {
            headers: { cookie: "explicit=yes", authorization: "Bearer explicit" },
        });
        expect(appFetch.mock.calls[1][0].headers.get("cookie")).toBe("explicit=yes");
        expect(appFetch.mock.calls[1][0].headers.get("authorization")).toBe("Bearer explicit");
        for (const credentials of ["omit", "same-origin", "include"] as const) {
            await internal("/api/public", { credentials });
            expect(appFetch.mock.lastCall![0].headers.has("cookie")).toBe(false);
            expect(appFetch.mock.lastCall![0].headers.has("authorization")).toBe(false);
        }
        await internal("https://other.test/api");
        expect(network).toHaveBeenCalledWith("https://other.test/api", {
            signal: expect.any(AbortSignal),
        });
        expect(() => internal("//other.test/api")).toThrow("request origin");
        expect(() => internal("/\\other.test/api")).toThrow("request origin");
    });
});
