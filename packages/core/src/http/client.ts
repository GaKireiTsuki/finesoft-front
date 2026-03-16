/**
 * HttpClient — 通用 HTTP 客户端基类
 *
 * 为 API Client 提供标准化的 HTTP 请求能力。
 * 子类继承后只需关注业务端点定义，不需要重复实现 fetch / JSON 解析 / 错误处理。
 */

/** HTTP 请求错误 */
export class HttpError extends Error {
    constructor(
        public readonly status: number,
        public readonly statusText: string,
        public readonly body?: string,
    ) {
        super(`HTTP ${status}: ${statusText}`);
        this.name = "HttpError";
    }
}

/** HttpClient 构造配置 */
export interface HttpClientConfig {
    /** API base URL（如 "/api" 或 "https://example.com/api"） */
    baseUrl: string;
    /** 默认请求头 */
    defaultHeaders?: Record<string, string>;
    /** 自定义 fetch 实现（便于测试或 SSR） */
    fetch?: typeof globalThis.fetch;
}

/**
 * 通用 HTTP 客户端基类
 *
 * 使用方式: 创建子类继承 HttpClient，定义业务方法调用 this.get() / this.post() 等。
 *
 * @example
 * ```ts
 * class MyApiClient extends HttpClient {
 *   async getUser(id: string) {
 *     return this.get<User>(`/users/${id}`);
 *   }
 * }
 * ```
 */
export abstract class HttpClient {
    protected readonly baseUrl: string;
    protected readonly defaultHeaders: Record<string, string>;
    protected readonly fetchFn: typeof globalThis.fetch;

    constructor(config: HttpClientConfig) {
        this.baseUrl = config.baseUrl;
        this.defaultHeaders = config.defaultHeaders ?? {};
        this.fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis);
    }

    /** GET 请求，返回解析后的 JSON */
    protected async get<T>(path: string, params?: Record<string, string>): Promise<T> {
        return this.request<T>("GET", path, { params });
    }

    /** POST 请求，自动序列化 body 为 JSON */
    protected async post<T>(
        path: string,
        body?: unknown,
        params?: Record<string, string>,
    ): Promise<T> {
        return this.request<T>("POST", path, { body, params });
    }

    /** PUT 请求 */
    protected async put<T>(
        path: string,
        body?: unknown,
        params?: Record<string, string>,
    ): Promise<T> {
        return this.request<T>("PUT", path, { body, params });
    }

    /** DELETE 请求 */
    protected async del<T>(path: string, params?: Record<string, string>): Promise<T> {
        return this.request<T>("DELETE", path, { params });
    }

    /**
     * 底层请求方法 — 子类可覆写以自定义行为
     *
     * 自动处理:
     * - URL 拼接 (baseUrl + path + params)
     * - 默认 headers 合并
     * - JSON body 序列化
     * - 响应 JSON 解析
     * - 非 2xx 状态码抛出 HttpError
     */
    protected async request<T>(
        method: string,
        path: string,
        options?: {
            params?: Record<string, string>;
            body?: unknown;
            headers?: Record<string, string>;
        },
    ): Promise<T> {
        const url = this.buildUrl(path, options?.params);

        const headers: Record<string, string> = {
            ...this.defaultHeaders,
            ...options?.headers,
        };

        const init: RequestInit = { method, headers };

        if (options?.body !== undefined) {
            headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
            init.body = JSON.stringify(options.body);
        }

        const response = await this.fetchFn(url, init);

        if (!response.ok) {
            const body = await response.text().catch(() => undefined);
            throw new HttpError(response.status, response.statusText, body);
        }

        return response.json();
    }

    /** 构建完整 URL — 子类可覆写以自定义 URL 拼接逻辑 */
    protected buildUrl(path: string, params?: Record<string, string>): string {
        const base = this.baseUrl.endsWith("/") ? this.baseUrl.slice(0, -1) : this.baseUrl;
        const normalizedPath = path.startsWith("/") ? path : `/${path}`;
        const url = new URL(`${base}${normalizedPath}`, "http://placeholder");

        if (params) {
            for (const [k, v] of Object.entries(params)) {
                url.searchParams.set(k, v);
            }
        }

        // 如果 baseUrl 是绝对 URL，返回完整 URL；否则只返回 path + search
        if (this.baseUrl.startsWith("http")) {
            return url.toString();
        }
        return `${url.pathname}${url.search}`;
    }
}
