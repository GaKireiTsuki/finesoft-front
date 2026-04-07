/**
 * URL 路由器 — URL pattern → Intent + FlowAction
 */

import { makeFlowAction, type FlowAction } from "../actions/types";
import type { Intent } from "../intents/types";
import type { AfterLoadGuard, BeforeLoadGuard } from "../middleware/types";

/** 路由匹配结果 */
export interface RouteMatch {
    intent: Intent;
    action: FlowAction;
    renderMode?: string;
    /** 该路由绑定的 beforeLoad 守卫 */
    beforeGuards?: BeforeLoadGuard[];
    /** 该路由绑定的 afterLoad 守卫 */
    afterGuards?: AfterLoadGuard[];
}

/** 路由添加选项 */
export interface RouteAddOptions {
    renderMode?: string;
    beforeGuards?: BeforeLoadGuard[];
    afterGuards?: AfterLoadGuard[];
}

interface InternalRouteDefinition {
    pattern: string;
    intentId: string;
    regex: RegExp;
    paramNames: string[];
    renderMode?: string;
    beforeGuards?: BeforeLoadGuard[];
    afterGuards?: AfterLoadGuard[];
}

export class Router {
    private routes: InternalRouteDefinition[] = [];

    /** 添加路由规则 */
    add(pattern: string, intentId: string, renderModeOrOptions?: string | RouteAddOptions): this {
        const opts: RouteAddOptions =
            typeof renderModeOrOptions === "string"
                ? { renderMode: renderModeOrOptions }
                : (renderModeOrOptions ?? {});

        const paramNames: string[] = [];

        // 将 /:param 和 /:param? 替换为捕获组，其余部分转义正则元字符
        const regexStr = pattern
            .split(/(\/:[\w]+\??)/)
            .map((segment) => {
                const paramMatch = segment.match(/^\/:(\w+)(\?)?$/);
                if (paramMatch) {
                    if (paramNames.includes(paramMatch[1])) {
                        throw new Error(
                            `[Router] Duplicate parameter name ":${paramMatch[1]}" in pattern "${pattern}"`,
                        );
                    }
                    paramNames.push(paramMatch[1]);
                    return paramMatch[2] ? "(?:/([^/]+))?" : "/([^/]+)";
                }
                // 非参数片段：转义所有正则特殊字符
                return segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
            })
            .join("");

        this.routes.push({
            pattern,
            intentId,
            regex: new RegExp(`^${regexStr}/?$`),
            paramNames,
            renderMode: opts.renderMode,
            beforeGuards: opts.beforeGuards,
            afterGuards: opts.afterGuards,
        });

        return this;
    }

    /** 解析 URL → RouteMatch */
    resolve(urlOrPath: string): RouteMatch | null {
        const { path, queryParams } = this.parseUrl(urlOrPath);

        for (const route of this.routes) {
            const match = path.match(route.regex);
            if (match) {
                // 使用无原型对象，这样 URL 提供的键就不会通过像 "__proto__" 这样的特殊名称
                // 去篡改 Object.prototype。
                const params = Object.create(null) as Record<string, string>;
                route.paramNames.forEach((name, index) => {
                    const value = match[index + 1];
                    if (value) params[name] = value;
                });
                for (const [k, v] of Object.entries(queryParams)) {
                    if (!(k in params)) params[k] = v;
                }

                return {
                    intent: { id: route.intentId, params },
                    action: makeFlowAction(urlOrPath),
                    renderMode: route.renderMode,
                    beforeGuards: route.beforeGuards,
                    afterGuards: route.afterGuards,
                };
            }
        }

        return null;
    }

    /** 获取所有已注册的路由 */
    getRoutes(): string[] {
        return this.routes.map((r) => `${r.pattern} → ${r.intentId}`);
    }

    private parseUrl(url: string): {
        path: string;
        queryParams: Record<string, string>;
    } {
        try {
            const parsed = new URL(url, "http://localhost");
            // Query parameter names come from the URL, so keep them in a
            // null-prototype object to avoid prototype pollution sinks.
            const params = Object.create(null) as Record<string, string>;
            parsed.searchParams.forEach((v, k) => {
                params[k] = v;
            });
            return { path: parsed.pathname, queryParams: params };
        } catch {
            return {
                path: url.split("?")[0].split("#")[0],
                queryParams: Object.create(null) as Record<string, string>,
            };
        }
    }
}
