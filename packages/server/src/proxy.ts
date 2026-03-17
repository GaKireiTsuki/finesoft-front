/**
 * 框架级声明式代理路由
 *
 * 将代理路由从业务层手写 Hono 路由，改为框架级配置。
 * 框架统一执行路径校验（SSRF 防护）、Host 限制、错误处理、响应头控制。
 */

import type { Hono } from "hono";

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
    /** 代理目标地址（必须以 "https://" 开头） */
    target: string;
    /** HTTP 方法（默认 ["all"]） */
    methods?: ("all" | "get" | "post" | "put" | "delete" | "patch")[];
    /** 附加到代理请求的头部 */
    headers?: Record<string, string>;
    /** 认证配置 */
    auth?: ProxyAuthConfig;
    /** Cache-Control 响应头 */
    cache?: string;
    /** 是否跟随重定向（默认 false） */
    followRedirects?: boolean;
}

/** 代理路径最大长度 */
const MAX_PROXY_PATH_LENGTH = 2048;
/** 代理响应最大体积（10 MB） */
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;

/**
 * 校验代理路径，防止 SSRF（协议相对 URL 绕过、编码绕过）。
 * 返回规范化的路径，或 null 表示非法。
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
    if (!config.target.startsWith("https://")) {
        throw new Error(`[proxy] target must use HTTPS: "${config.target}"`);
    }
}

/**
 * 注册声明式代理路由到 Hono app（运行时使用：dev / preview / createServer）
 */
export function registerProxyRoutes(app: Hono, configs: ProxyRouteConfig[]): void {
    for (const config of configs) {
        validateConfig(config);

        const methods = config.methods ?? ["all"];
        const pattern = `${config.prefix}/*`;

        const handler = async (c: any) => {
            const subPath = sanitizeProxyPath(c.req.path.replace(config.prefix, ""));
            if (!subPath) return c.text("Invalid path", 400);

            const targetUrl = new URL(subPath, config.target);

            // 防止开放重定向：校验构建后的 URL origin 不变
            const expectedOrigin = new URL(config.target).origin;
            if (targetUrl.origin !== expectedOrigin) {
                return c.text("Invalid proxy target", 400);
            }

            // 转发 query 参数
            const reqUrl = new URL(c.req.url);
            reqUrl.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));

            // 构建请求头
            const headers: Record<string, string> = { ...config.headers };
            if (config.auth) {
                const token = process.env[config.auth.envKey];
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
                const resp = await fetch(targetUrl.toString(), {
                    headers,
                    redirect: config.followRedirects ? "follow" : "manual",
                });

                // 响应大小限制
                const contentLength = resp.headers.get("Content-Length");
                if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
                    return c.text("Proxy response too large", 502);
                }

                const body = await resp.text();
                if (body.length > MAX_RESPONSE_SIZE) {
                    return c.text("Proxy response too large", 502);
                }

                const respHeaders: Record<string, string> = {
                    "Content-Type": resp.headers.get("Content-Type") ?? "application/json",
                };
                if (config.cache) {
                    respHeaders["Cache-Control"] = config.cache;
                }
                return c.newResponse(body, resp.status as any, respHeaders);
            } catch (e) {
                console.error(`[Proxy ${config.prefix}]`, e);
                return c.json({ error: "Proxy request failed" }, 502);
            }
        };

        for (const method of methods) {
            (app as any)[method](pattern, handler);
        }
    }
}

/**
 * 生成代理路由的内联代码（用于 serverless/edge 入口，避免运行时依赖）
 */
export function generateProxyCode(configs: ProxyRouteConfig[]): string {
    if (!configs || configs.length === 0) return "";

    // 运行时也校验一遍
    for (const config of configs) {
        validateConfig(config);
    }

    const blocks: string[] = [];

    blocks.push(`
// ─── 框架声明式代理路由 ───
function _sanitizeProxyPath(raw) {
  if (raw.length > 2048) return null;
  try { if (decodeURIComponent(raw) !== raw) return null; } catch { return null; }
  if (raw.startsWith("//")) return null;
  if (!/^[/\\w.\\-~%:@!$&'()*+,;=]*$/.test(raw)) return null;
  return raw.startsWith("/") ? raw : "/" + raw;
}
`);

    for (const config of configs) {
        const methods = config.methods ?? ["all"];
        const pattern = `"${config.prefix}/*"`;
        const headersJson = JSON.stringify(config.headers ?? {});
        const cacheStr = config.cache ? JSON.stringify(config.cache) : "null";
        const redirect = config.followRedirects ? '"follow"' : '"manual"';

        let authCode = "";
        if (config.auth) {
            const envKey = JSON.stringify(config.auth.envKey);
            const prefix = config.auth.type === "bearer" ? "Bearer " : "Basic ";
            authCode = `
  const _token = (typeof process !== "undefined" && process.env && process.env[${envKey}]) || "";
  if (_token) _headers.Authorization = "${prefix}" + _token;`;
        }

        const handlerCode = `async (c) => {
  const _sub = _sanitizeProxyPath(c.req.path.replace(${JSON.stringify(config.prefix)}, ""));
  if (!_sub) return c.text("Invalid path", 400);
  const _target = new URL(_sub, ${JSON.stringify(config.target)});
  const _reqUrl = new URL(c.req.url);
  _reqUrl.searchParams.forEach((v, k) => _target.searchParams.set(k, v));
  const _headers = ${headersJson};${authCode}
  try {
    const _resp = await fetch(_target.toString(), { headers: _headers, redirect: ${redirect} });
    const _body = await _resp.text();
    const _rh = { "Content-Type": _resp.headers.get("Content-Type") || "application/json" };
    if (${cacheStr}) _rh["Cache-Control"] = ${cacheStr};
    return c.newResponse(_body, _resp.status, _rh);
  } catch (_e) {
    console.error("[Proxy ${config.prefix}]", _e);
    return c.json({ error: "Proxy request failed" }, 502);
  }
}`;

        for (const method of methods) {
            blocks.push(`app.${method}(${pattern}, ${handlerCode});`);
        }
    }

    return blocks.join("\n");
}
