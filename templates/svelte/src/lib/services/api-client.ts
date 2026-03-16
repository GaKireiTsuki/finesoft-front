import { HttpClient, type HttpClientConfig } from "@finesoft/front";

/**
 * Demo API client — extends HttpClient for typed endpoint access.
 *
 * Showcases HttpClient subclass pattern with base URL and custom fetch.
 */
export class ApiClient extends HttpClient {
    constructor(config?: Partial<HttpClientConfig>) {
        super({
            baseUrl: config?.baseUrl ?? "/api",
            defaultHeaders: { "Content-Type": "application/json", ...config?.defaultHeaders },
            fetch: config?.fetch,
        });
    }

    async getProducts(): Promise<unknown[]> {
        return this.get<unknown[]>("/products");
    }

    async getProduct(id: string): Promise<unknown> {
        return this.get<unknown>(`/products/${id}`);
    }

    async searchProducts(query: string): Promise<unknown[]> {
        return this.get<unknown[]>("/products", { q: query });
    }
}
