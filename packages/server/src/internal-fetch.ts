/**
 * createInternalFetch — SSR 内部路由回环 fetch 包装器
 *
 * 将相对路径（/api/…）请求转为 Hono app.fetch 内存调用，
 * 绝对 URL 和非字符串 input 走 globalThis.fetch（真实网络）。
 *
 * 递归深度保护采用请求头传递：每次 SSR 回环在请求头中写入深度值，
 * SSR catch-all 读取深度判断是否超限。对比闭包计数器方案：
 * - 并发安全：无共享可变状态
 * - 跨渲染准确：深度随请求在 Hono 路由链中传递
 */

export const SSR_DEPTH_HEADER = "x-ssr-depth";
export const MAX_SSR_DEPTH = 5;

/**
 * 创建请求级 internal fetch
 *
 * @param appFetch - Hono app.fetch（父级路由）
 * @param depth - 当前 SSR 深度（由 catch-all handler 从请求头读取后 +1 传入）
 */
export function createInternalFetch(
    appFetch: (request: Request) => Response | Promise<Response>,
    depth: number = 1,
): typeof globalThis.fetch {
    return ((input: RequestInfo | URL, init?: RequestInit) => {
        // 只拦截相对路径（以 / 开头），其他一律走真实网络
        if (typeof input === "string" && input.startsWith("/")) {
            const request = new Request(`http://localhost${input}`, init);
            request.headers.set(SSR_DEPTH_HEADER, String(depth));
            return Promise.resolve(appFetch(request));
        }

        // 绝对 URL / URL 对象 / Request 对象 → 走正常网络
        return globalThis.fetch(input, init);
    }) as typeof globalThis.fetch;
}
