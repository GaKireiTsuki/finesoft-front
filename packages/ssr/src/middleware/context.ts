import type { Container, Intent } from "@finesoft/core";
import type { NavigationContext } from "@finesoft/web";
import { parseCookieString } from "../../../web/src/middleware/cookies";
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
        params: intent.params ?? {},
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
