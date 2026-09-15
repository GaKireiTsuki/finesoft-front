/**
 * HttpClient — 通用 HTTP 客户端基类
 *
 * 为 API Client 提供标准化的 HTTP 请求能力。
 * 子类继承后只需关注业务端点定义，不需要重复实现 fetch / JSON 解析 / 错误处理。
 *
 * 默认安全：拒绝向内网 / loopback / 保留地址发请求（SSRF 防御）。应用层
 * 显式 opt-out 用 `allowInternalHosts: true`。详见 host-guard.ts。
 */

export { HostGuardError, HttpError } from "./errors";
import { HttpError } from "./errors";
import { enforceHostGuard, type DnsLookup } from "./target-guard";
/** 请求拦截器 — 在发送前修改请求 */
export interface RequestInterceptor {
    (url: string, init: RequestInit): RequestInit | Promise<RequestInit>;
}

/** 响应拦截器 — 在解析前修改响应 */
export interface ResponseInterceptor {
    (response: Response, url: string): Response | Promise<Response>;
}

/** HttpClient 构造配置 */
export interface HttpClientConfig {
    /** API base URL（如 "/api" 或 "https://example.com/api"） */
    baseUrl: string;
    /** 默认请求头 */
    defaultHeaders?: Record<string, string>;
    /** 自定义 fetch 实现（便于测试或 SSR） */
    fetch: typeof globalThis.fetch;
    /** 请求拦截器（按注册顺序执行） */
    requestInterceptors?: RequestInterceptor[];
    /** 响应拦截器（按注册顺序执行） */
    responseInterceptors?: ResponseInterceptor[];
    /**
     * 是否允许向私有 / loopback / 保留 IP 段发请求。
     *
     * **默认 false** —— 阻止内网穿透（SSRF）。如果你的服务正常需要打内网（如
     * 微服务对内 API、127.0.0.1 上的开发依赖），把它设为 true 显式 opt-out，并
     * 自己做来源校验。
     */
    allowInternalHosts?: boolean;
    /**
     * 是否在请求前 DNS 解析 hostname 并对解析结果做 IP 段校验。
     *
     * **默认 true**（须显式提供 lookup；浏览器可显式选择 false）。配合 `allowInternalHosts`
     * 防御 DNS rebinding：如果 hostname 不是 IP 字面量，框架会 resolve 它的 A/AAAA
     * 记录并按 IP 段校验。`false` 关闭只剩 IP 字面量同步校验。
     */
    validateDns?: boolean;
    lookup?: DnsLookup;
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
    private readonly requestInterceptors: RequestInterceptor[];
    private readonly responseInterceptors: ResponseInterceptor[];
    private readonly allowInternalHosts: boolean;
    private readonly validateDns: boolean;
    private readonly lookup?: DnsLookup;

    constructor(config: HttpClientConfig) {
        this.baseUrl = config.baseUrl;
        this.defaultHeaders = config.defaultHeaders ?? {};
        this.fetchFn = config.fetch;
        this.requestInterceptors = [...(config.requestInterceptors ?? [])];
        this.responseInterceptors = [...(config.responseInterceptors ?? [])];
        this.allowInternalHosts = config.allowInternalHosts ?? false;
        this.validateDns = config.validateDns ?? true;
        this.lookup = config.lookup;
    }

    /** 动态添加请求拦截器 */
    useRequestInterceptor(interceptor: RequestInterceptor): this {
        this.requestInterceptors.push(interceptor);
        return this;
    }

    /** 动态添加响应拦截器 */
    useResponseInterceptor(interceptor: ResponseInterceptor): this {
        this.responseInterceptors.push(interceptor);
        return this;
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
     * - SSRF 防护（IP 字面量同步校验 + 可选 DNS 解析校验）
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

        if (!this.allowInternalHosts) {
            await enforceHostGuard(url, { validateDns: this.validateDns, lookup: this.lookup });
        }

        const headers: Record<string, string> = {
            ...this.defaultHeaders,
            ...options?.headers,
        };

        let init: RequestInit = { method, headers };

        if (options?.body !== undefined) {
            // 大小写不敏感地检测用户是否已设置 Content-Type
            const hasContentType = Object.keys(headers).some(
                (k) => k.toLowerCase() === "content-type",
            );
            if (!hasContentType) {
                headers["Content-Type"] = "application/json";
            }
            init.body = JSON.stringify(options.body);
        }

        // 请求拦截器链
        for (const interceptor of this.requestInterceptors) {
            init = await interceptor(url, init);
        }

        let response = await this.fetchFn(url, init);

        // 响应拦截器链
        for (const interceptor of this.responseInterceptors) {
            response = await interceptor(response, url);
        }

        if (!response.ok) {
            const body = await response.text().catch(() => undefined);
            throw new HttpError(response.status, response.statusText, body);
        }

        try {
            return (await response.json()) as T;
        } catch (e) {
            if (e instanceof SyntaxError) {
                throw new HttpError(
                    response.status,
                    "Invalid JSON response",
                    await response.text().catch(() => undefined),
                );
            }
            throw e;
        }
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
