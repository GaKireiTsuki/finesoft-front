/**
 * 框架级声明式代理路由
 *
 * 将代理路由从业务层手写 Hono 路由，改为框架级配置。
 * 框架统一执行路径校验（SSRF 防护）、Host 限制、错误处理、响应头控制。
 */

import { fetchWithRedirects } from "@finesoft/core";

/** 代理路由认证配置 */
export interface ProxyAuthConfig {
    /** 认证类型 */
    type: "bearer" | "basic";
    /** 环境变量名称（运行时从 process.env 读取） */
    envKey: string;
}

/** 声明式代理路由配置 */
export interface ProxyRouteConfig {
    /** URL 前缀，如 "/api/apple"（必须以 "/" 开头） */
    prefix: string;
    /** 代理目标地址（以 "https://" 或 "http://" 开头，推荐 HTTPS） */
    target: string;
    /** HTTP 方法（默认 ["all"]） */
    methods?: ("all" | "get" | "post" | "put" | "delete" | "patch")[];
    /** 附加到代理请求的头部 */
    headers?: Record<string, string>;
    /** 认证配置 */
    auth?: ProxyAuthConfig;
    /** Cache-Control 响应头 */
    cache?: string;
    /** 是否跟随同源重定向（默认 false）；跨源重定向始终拒绝。 */
    followRedirects?: boolean;
}

type ProxyRouteRegistrar = (path: string, handler: (context: any) => Promise<Response>) => unknown;
/** The registration surface used by Hono; portable SSR declarations need no Hono peer. */
export interface ProxyRouter {
    all: ProxyRouteRegistrar;
    get: ProxyRouteRegistrar;
    post: ProxyRouteRegistrar;
    put: ProxyRouteRegistrar;
    delete: ProxyRouteRegistrar;
    patch: ProxyRouteRegistrar;
}

/** 代理路径最大长度 */
const MAX_PROXY_PATH_LENGTH = 2048;
/** 代理响应最大体积（10 MB） */
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;

/**
 * 校验代理路径，防止 SSRF（协议相对 URL 绕过、编码绕过）。
 * 返回规范化的路径，或 null 表示非法。
 *
 * 策略保守：拒绝任何含编码字符的路径，避免上游对 %2F 等解码差异导致绕过。
 * 副作用：合法的 %20、%E4%B8%AD（Unicode）也会被拒。
 * 如需放宽，应在上层路由前自行 decode，或为该代理单独提供 sanitizer 选项。
 */
function sanitizeProxyPath(raw: string): string | null {
    if (raw.length > MAX_PROXY_PATH_LENGTH) return null;
    // 解码后比对防止 %2F 等编码绕过
    try {
        const decoded = decodeURIComponent(raw);
        if (decoded !== raw) return null;
    } catch {
        return null;
    }
    if (raw.startsWith("//")) return null;
    // 仅允许安全路径字符
    if (!/^[/\w.\-~%:@!$&'()*+,;=]*$/.test(raw)) return null;
    return raw.startsWith("/") ? raw : `/${raw}`;
}

/**
 * 校验代理配置合法性。
 * 在注册时（启动阶段）调用，非法配置直接抛错阻止启动。
 */
function validateConfig(config: ProxyRouteConfig): void {
    if (!config.prefix.startsWith("/")) {
        throw new Error(`[proxy] prefix must start with "/": "${config.prefix}"`);
    }
    const isHttps = config.target.startsWith("https://");
    const isHttp = config.target.startsWith("http://");
    if (!isHttps && !isHttp) {
        throw new Error(
            `[proxy] target must start with "https://" or "http://": "${config.target}"`,
        );
    }
    if (isHttp) {
        console.warn(
            `[proxy] ⚠ target "${config.target}" uses plain HTTP — traffic will not be encrypted. ` +
                `Use HTTPS in production to prevent data interception.`,
        );
    }
}

/**
 * 注册声明式代理路由到 Hono app（运行时使用：Vite dev / preview / generated hosts）
 */
export function registerProxyRoutes(app: ProxyRouter, configs: ProxyRouteConfig[]): void {
    for (const config of configs) {
        validateConfig(config);

        const methods = config.methods ?? ["all"];
        const pattern = `${config.prefix}/*`;
        const handler = createProxyHandler(config);

        for (const method of methods) {
            app[method](pattern, handler);
        }
    }
}

function createProxyHandler(config: ProxyRouteConfig) {
    return async (c: any) => {
        const subPath = sanitizeProxyPath(c.req.path.replace(config.prefix, ""));
        if (!subPath) return c.text("Invalid path", 400);

        const targetUrl = new URL(subPath, config.target);

        // 防止开放重定向：校验构建后的 URL origin 不变
        const expectedOrigin = new URL(config.target).origin;
        if (targetUrl.origin !== expectedOrigin) return c.text("Invalid proxy target", 400);

        // 转发 query 参数
        const reqUrl = new URL(c.req.url);
        reqUrl.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));

        const headers: Record<string, string> = { ...config.headers };
        if (config.auth) {
            // Edge runtimes need not expose a Node process object. Authentication remains
            // unset there unless the host supplies its own proxy registration config.
            const token =
                typeof process !== "undefined" && process.env
                    ? process.env[config.auth.envKey]
                    : undefined;
            if (!token) {
                console.warn(
                    `[Proxy ${config.prefix}] Auth env var "${config.auth.envKey}" is not set`,
                );
            } else {
                headers.Authorization =
                    config.auth.type === "bearer" ? `Bearer ${token}` : `Basic ${token}`;
            }
        }

        try {
            const resp = await fetchWithRedirects(
                fetch,
                targetUrl.toString(),
                { headers, redirect: config.followRedirects ? "follow" : "manual" },
                (url) => {
                    if (new URL(url).origin !== expectedOrigin)
                        throw new TypeError("Invalid proxy redirect target");
                },
            );

            // 响应大小限制（先检查 Content-Length 头快速拒绝）
            const contentLength = resp.headers.get("Content-Length");
            if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
                void resp.body?.cancel().catch(() => {});
                return c.text("Proxy response too large", 502);
            }

            const body = await readProxyBody(resp);
            if (!body) {
                return c.text("Proxy response too large", 502);
            }

            const respHeaders: Record<string, string> = {
                "Content-Type": resp.headers.get("Content-Type") ?? "application/json",
            };
            if (config.cache) respHeaders["Cache-Control"] = config.cache;
            return c.newResponse(body, resp.status as any, respHeaders);
        } catch (e) {
            console.error(`[Proxy ${config.prefix}]`, e);
            return c.json({ error: "Proxy request failed" }, 502);
        }
    };
}

/** Bound allocation while preserving binary bytes, even without Content-Length. */
async function readProxyBody(response: Response): Promise<ArrayBuffer | undefined> {
    if (!response.body) return new ArrayBuffer(0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_RESPONSE_SIZE) {
                void reader.cancel().catch(() => {});
                return undefined;
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body.buffer;
}

/**
 * 生成代理路由注册代码（用于 serverless/edge 入口）。
 * 生成的入口从公开 SSR 边界导入 registerProxyRoutes，因此安全策略只有一个运行时实现。
 */
export function generateProxyCode(configs: ProxyRouteConfig[]): string {
    if (!configs || configs.length === 0) return "";

    // 运行时也校验一遍
    for (const config of configs) {
        validateConfig(config);
    }

    return `// ─── 框架声明式代理路由 ───\nregisterProxyRoutes(app, ${JSON.stringify(configs)});`;
}
