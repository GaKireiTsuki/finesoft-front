import type { Container, Intent } from "@finesoft/core";
import type { NavigationContext } from "@finesoft/web";
import { parseCookieString } from "@finesoft/web";
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
        params: intent.params ?? {},
        intent,
        isServer: false,
        container,
        getCookie: (name: string) => parseCookieString(document.cookie).get(name),
        getHeader: () => undefined,
    };
}
