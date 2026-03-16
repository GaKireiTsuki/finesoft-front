/**
 * Navigation Context — 构建器
 *
 * 为 SSR（服务端）和 Browser（客户端）两种环境创建统一的 NavigationContext。
 */

import type { Container } from "../dependencies/container";
import type { Intent } from "../intents/types";
import type { NavigationContext } from "./types";

// =====================================================================
// Cookie 解析
// =====================================================================

function parseCookieString(str: string): Map<string, string> {
    const map = new Map<string, string>();
    if (!str) return map;
    for (const pair of str.split(";")) {
        const idx = pair.indexOf("=");
        if (idx === -1) continue;
        const key = pair.slice(0, idx).trim();
        const val = pair.slice(idx + 1).trim();
        if (key) map.set(key, val);
    }
    return map;
}

// =====================================================================
// Server Context
// =====================================================================

export interface ServerContextOptions {
    url: string;
    intent: Intent;
    container: Container;
    /** 原始 Request 对象（提取 cookie 和 header） */
    request?: Request;
}

/** 从 Request 对象构建服务端上下文 */
export function createServerContext(options: ServerContextOptions): NavigationContext {
    const { url, intent, container, request } = options;
    const parsed = new URL(url, "http://localhost");

    const cookieHeader = request?.headers.get("cookie") ?? "";
    const cookies = parseCookieString(cookieHeader);

    return {
        url,
        path: parsed.pathname,
        params: (intent.params as Record<string, string>) ?? {},
        intent,
        isServer: true,
        container,
        getCookie: (name: string) => cookies.get(name),
        getHeader: (name: string) => request?.headers.get(name) ?? undefined,
    };
}

// =====================================================================
// Browser Context
// =====================================================================

export interface BrowserContextOptions {
    url: string;
    intent: Intent;
    container: Container;
}

/** 从 document.cookie 构建浏览器端上下文 */
export function createBrowserContext(options: BrowserContextOptions): NavigationContext {
    const { url, intent, container } = options;
    const parsed = new URL(url, window.location.origin);

    return {
        url,
        path: parsed.pathname,
        params: (intent.params as Record<string, string>) ?? {},
        intent,
        isServer: false,
        container,
        getCookie: (name: string) => parseCookieString(document.cookie).get(name),
        getHeader: () => undefined,
    };
}
