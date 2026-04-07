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
});
