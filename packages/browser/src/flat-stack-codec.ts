/**
 * 扁平栈 codec —— flat-islands 用：URL ↔ 单叶栈。
 *
 * - decode(url, router)：同步把 URL 匹配成单叶意图，返回 stack([leaf(intent, params)])；
 *   不可路由时返回 undefined（bridge 保留当前树，与 createActiveLeafCodec 约定一致）。
 * - encode(tree, router)：取栈顶（激活叶子）的 intent + params 反查 URL；
 *   无对应路由时回退 "/"。
 *
 * 设计决策：
 * - NavigationRouterLike 只暴露 getRoutes()（"pattern → intentId" 摘要）和可选的 reverse()。
 *   decode 无法调用 Router.resolve()（异步），因此从摘要重建正则自行匹配——
 *   pattern 语法与 Router.add() 完全一致（/:name 和 /:name?），故可直接复原。
 * - 全部复用 core/src/navigation/codec.ts 中已有的共享工具（reverseUrl 的等效逻辑）；
 *   encoder 侧直接借用 createActiveLeafCodec 使用的 collectVisibleDestinations + reverse 路径。
 */

import {
    collectVisibleDestinations,
    leaf,
    stack,
    type NavigationCodec,
    type NavigationNode,
    type NavigationRouterLike,
} from "@finesoft/core";

// =====================================================================
// 同步 URL 匹配（基于 getRoutes() 摘要重建正则）
// =====================================================================

const URL_BASE = "http://localhost";
const ROUTE_SUMMARY_SEP = " → ";

interface ParsedRoute {
    readonly pattern: string;
    readonly intentId: string;
}

function parseRouteSummaries(router: NavigationRouterLike): ParsedRoute[] {
    const out: ParsedRoute[] = [];
    for (const summary of router.getRoutes()) {
        const idx = summary.indexOf(ROUTE_SUMMARY_SEP);
        if (idx === -1) continue;
        const pattern = summary.slice(0, idx);
        const intentId = summary.slice(idx + ROUTE_SUMMARY_SEP.length);
        if (pattern && intentId) out.push({ pattern, intentId });
    }
    return out;
}

interface CompiledRoute extends ParsedRoute {
    readonly regex: RegExp;
    readonly paramNames: string[];
}

/**
 * 从 pattern 字符串重建正则 + 参数名列表。
 * 语法与 Router.add() 完全一致：/:name（必填）、/:name?（可选）。
 */
function compilePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];
    const regexStr = pattern
        .split(/(\/:[\w]+\??)/)
        .map((segment) => {
            const m = segment.match(/^\/:(\w+)(\?)?$/);
            if (m) {
                paramNames.push(m[1]);
                return m[2] ? "(?:/([^/]+))?" : "/([^/]+)";
            }
            return segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
    return { regex: new RegExp(`^${regexStr}/?$`), paramNames };
}

function compileRoutes(router: NavigationRouterLike): CompiledRoute[] {
    return parseRouteSummaries(router).map((r) => {
        const { regex, paramNames } = compilePattern(r.pattern);
        return { ...r, regex, paramNames };
    });
}

/**
 * 同步 URL → { intentId, params }。
 * 匹配逻辑与 Router.resolve() 的 path+query 部分完全对应（跳过异步 paramCodec 校验，
 * 仅做字符串提取——flat codec 的合法 URL 不含自定义 codec，这是 flat-islands 的设计前提）。
 */
function syncMatch(
    url: string,
    routes: CompiledRoute[],
): { intentId: string; params: Record<string, string> } | undefined {
    let path: string;
    let queryParams: Record<string, string>;
    try {
        const parsed = new URL(url, URL_BASE);
        path = parsed.pathname;
        queryParams = Object.fromEntries(parsed.searchParams);
    } catch {
        path = url.split("?")[0].split("#")[0] || "/";
        queryParams = {};
    }

    for (const route of routes) {
        const m = path.match(route.regex);
        if (!m) continue;
        const params: Record<string, string> = Object.assign(Object.create(null), queryParams);
        for (let i = 0; i < route.paramNames.length; i++) {
            const raw = m[i + 1];
            if (raw !== undefined) params[route.paramNames[i]] = raw;
        }
        return { intentId: route.intentId, params };
    }
    return undefined;
}

// =====================================================================
// encode 侧：反查 URL（镜像 codec.ts 中的 reverseUrl）
// =====================================================================

function paramToString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "string") return value;
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
    if (typeof value === "boolean") return String(value);
    return undefined;
}

function substitutePattern(pattern: string, params: Record<string, unknown>): string | undefined {
    const consumed = new Set<string>();
    let ok = true;
    const path = pattern
        .split(/(\/:[\w]+\??)/)
        .map((segment) => {
            const m = segment.match(/^\/:(\w+)(\?)?$/);
            if (!m) return segment;
            const name = m[1];
            const optional = m[2] === "?";
            const value = paramToString(params[name]);
            if (value === undefined) {
                if (optional) return "";
                ok = false;
                return "";
            }
            consumed.add(name);
            return `/${encodeURIComponent(value)}`;
        })
        .join("");
    if (!ok) return undefined;
    const finalPath = path === "" ? "/" : path;
    const query = new URLSearchParams();
    for (const key of Object.keys(params).sort()) {
        if (consumed.has(key)) continue;
        const value = paramToString(params[key]);
        if (value !== undefined) query.set(key, value);
    }
    const qs = query.toString();
    return qs ? `${finalPath}?${qs}` : finalPath;
}

function reverseUrl(
    router: NavigationRouterLike,
    intentId: string,
    params: Record<string, unknown>,
): string | undefined {
    if (typeof router.reverse === "function") {
        const via = router.reverse(intentId, params as Record<string, string>);
        if (via !== undefined) return via;
    }
    for (const route of parseRouteSummaries(router)) {
        if (route.intentId !== intentId) continue;
        const built = substitutePattern(route.pattern, params);
        if (built !== undefined) return built;
    }
    return undefined;
}

// =====================================================================
// createFlatStackCodec
// =====================================================================

/**
 * 扁平栈 codec。
 *
 * decode: URL → stack([leaf(intent, params)])；不可路由 → undefined。
 * encode: 取激活叶子（collectVisibleDestinations 最后一项）的 URL；无法反查 → "/"。
 */
export function createFlatStackCodec(): NavigationCodec {
    return {
        decode(url: string, router: NavigationRouterLike): NavigationNode | undefined {
            const routes = compileRoutes(router);
            const match = syncMatch(url, routes);
            if (!match) return undefined;
            return stack([leaf(match.intentId, match.params)]);
        },

        encode(tree: NavigationNode, router: NavigationRouterLike): string {
            const visible = collectVisibleDestinations(tree);
            const top = visible[visible.length - 1];
            if (!top) return "/";
            return reverseUrl(router, top.intent, top.params) ?? "/";
        },
    };
}
