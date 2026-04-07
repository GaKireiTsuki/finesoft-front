import { describe, expect, test, vi } from "vite-plus/test";
import { HttpClient, HttpError } from "../../src/http/client";

class TestHttpClient extends HttpClient {
    requestGet<T>(path: string, params?: Record<string, string>): Promise<T> {
        return this.get<T>(path, params);
    }

    requestPost<T>(path: string, body?: unknown, params?: Record<string, string>): Promise<T> {
        return this.post<T>(path, body, params);
    }

    requestPut<T>(path: string, body?: unknown, params?: Record<string, string>): Promise<T> {
        return this.put<T>(path, body, params);
    }

    requestDelete<T>(path: string, params?: Record<string, string>): Promise<T> {
        return this.del<T>(path, params);
    }

    build(path: string, params?: Record<string, string>): string {
        return this.buildUrl(path, params);
    }
}

describe("HttpClient", () => {
    test("builds relative and absolute URLs with query params", () => {
        const relativeClient = new TestHttpClient({ baseUrl: "/api" });
        const absoluteClient = new TestHttpClient({
            baseUrl: "https://example.com/api/",
        });

        expect(relativeClient.build("products", { page: "1" })).toBe("/api/products?page=1");
        expect(absoluteClient.build("/products", { page: "1" })).toBe(
            "https://example.com/api/products?page=1",
        );
    });

    test("serializes request bodies and applies interceptors", async () => {
        const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
        const requestInterceptor = vi.fn(async (_url: string, init: RequestInit) => ({
            ...init,
            headers: {
                ...(init.headers as Record<string, string>),
                Authorization: "Bearer token",
            },
        }));
        const responseInterceptor = vi.fn(
            async () =>
                new Response(JSON.stringify({ intercepted: true }), {
                    status: 200,
                }),
        );
        const client = new TestHttpClient({
            baseUrl: "/api",
            defaultHeaders: { "X-App": "finesoft" },
            fetch: fetchFn,
            requestInterceptors: [requestInterceptor],
            responseInterceptors: [responseInterceptor],
        });

        await expect(
            client.requestPost<{ intercepted: boolean }>("/products", { id: 1 }, { page: "2" }),
        ).resolves.toEqual({ intercepted: true });

        expect(fetchFn).toHaveBeenCalledWith("/api/products?page=2", {
            method: "POST",
            headers: {
                "X-App": "finesoft",
                "Content-Type": "application/json",
                Authorization: "Bearer token",
            },
            body: JSON.stringify({ id: 1 }),
        });
        expect(requestInterceptor).toHaveBeenCalled();
        expect(responseInterceptor).toHaveBeenCalled();
    });

    test("supports dynamic interceptor registration and all HTTP verbs", async () => {
        const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
        const client = new TestHttpClient({ baseUrl: "/api", fetch: fetchFn });

        client.useRequestInterceptor(async (_url, init) => ({
            ...init,
            headers: {
                ...(init.headers as Record<string, string>),
                "X-Request": "added",
            },
        }));
        client.useResponseInterceptor(async (response) => response);

        await client.requestGet("/items", { q: "hat" });
        await client.requestPut("/items/1", { title: "Updated" });
        await client.requestDelete("/items/1");

        expect(fetchFn).toHaveBeenNthCalledWith(1, "/api/items?q=hat", {
            method: "GET",
            headers: { "X-Request": "added" },
        });
        expect(fetchFn).toHaveBeenNthCalledWith(2, "/api/items/1", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "X-Request": "added",
            },
            body: JSON.stringify({ title: "Updated" }),
        });
        expect(fetchFn).toHaveBeenNthCalledWith(3, "/api/items/1", {
            method: "DELETE",
            headers: { "X-Request": "added" },
        });
    });

    test("throws HttpError for non-success responses", async () => {
        const client = new TestHttpClient({
            baseUrl: "/api",
            fetch: vi.fn(
                async () =>
                    new Response("not found", {
                        status: 404,
                        statusText: "Not Found",
                    }),
            ),
        });

        await expect(client.requestGet("/missing")).rejects.toEqual(
            expect.objectContaining({
                name: "HttpError",
                status: 404,
                statusText: "Not Found",
                body: "not found",
            }),
        );
    });

    test("throws HttpError when a successful response contains invalid JSON", async () => {
        const client = new TestHttpClient({
            baseUrl: "/api",
            fetch: vi.fn(
                async () =>
                    new Response("not-json", {
                        status: 200,
                        statusText: "OK",
                        headers: { "Content-Type": "application/json" },
                    }),
            ),
        });

        await expect(client.requestGet("/broken")).rejects.toEqual(
            expect.objectContaining<HttpError>({
                name: "HttpError",
                message: "HTTP 200: Invalid JSON response",
                status: 200,
                statusText: "Invalid JSON response",
            }),
        );
    });
});
