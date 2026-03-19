/**
 * defineRoutes — 声明式路由 + Controller 注册
 *
 * 将命令式的路由注册 (20+ 行 framework.router.add / framework.registerIntent)
 * 简化为声明式配置数组。
 */

import type { Framework } from "../framework";
import type { IntentController } from "../intents/types";
import type { AfterLoadGuard, BeforeLoadGuard } from "../middleware/types";

/** 渲染模式 */
export type RenderMode = "ssr" | "csr" | "prerender";

/** 单条路由定义 */
export interface RouteDefinition {
    /** URL pattern (如 "/product/:productId") */
    path: string;
    /** Intent ID (如 "product-page") */
    intentId: string;
    /**
     * Controller 实例（可选）。
     * 同一个 intentId 的多条路由只需在第一条提供 controller。
     */
    controller?: IntentController;
    /**
     * 渲染模式（可选，默认 "ssr"）。
     * - "ssr": 服务端渲染（默认）
     * - "csr": 客户端渲染（返回空壳 HTML，由客户端 JS 渲染）
     * - "prerender": 预渲染（构建时生成静态 HTML + ISR 缓存）
     */
    renderMode?: RenderMode;
    /**
     * 路由级 beforeLoad 守卫（可选）。
     * 在全局守卫之后执行，仅对匹配此路由的请求生效。
     */
    beforeLoad?: BeforeLoadGuard[];
    /**
     * 路由级 afterLoad 守卫（可选）。
     * 在全局守卫之后执行，仅对匹配此路由的请求生效。
     */
    afterLoad?: AfterLoadGuard[];
}

/** defineRoutes 选项 */
export interface DefineRoutesOptions {
    /**
     * 支持的 locale 列表。
     * 提供后，每条路由会额外注册 `/:locale/path` 版本，
     * `:locale` 参数自动出现在 `intent.params.locale` 中。
     * 原始无前缀路径保留作为备选路由。
     *
     * @example
     * ```ts
     * defineRoutes(framework, routes, { locales: ["zh", "en", "ja"] });
     * // "/about" → 注册 /about + /zh/about + /en/about + /ja/about
     * ```
     */
    locales?: string[];
}

/**
 * 声明式注册路由和 Controller
 *
 * - 自动去重: 同一 intentId 的 controller 只注册一次
 * - 路由和 controller 在同一个配置数组中，方便检查一致性
 *
 * @example
 * ```ts
 * defineRoutes(framework, [
 *   { path: "/",                intentId: "home",     controller: new HomeController() },
 *   { path: "/product/:id",    intentId: "product",  controller: new ProductController() },
 *   { path: "/search",         intentId: "search",   controller: new SearchController() },
 *   { path: "/charts/:type",   intentId: "charts",   controller: new ChartsController() },
 *   { path: "/charts",         intentId: "charts" },  // 同 intentId，不需要重复 controller
 * ]);
 * ```
 */
export function defineRoutes(
    framework: Framework,
    definitions: RouteDefinition[],
    options?: DefineRoutesOptions,
): void {
    const registeredIntents = new Set<string>();

    for (const def of definitions) {
        // 注册 Controller（每个 intentId 只注册一次）
        if (def.controller && !registeredIntents.has(def.intentId)) {
            framework.registerIntent(def.controller);
            registeredIntents.add(def.intentId);
        }

        const routeOpts = {
            renderMode: def.renderMode,
            beforeGuards: def.beforeLoad,
            afterGuards: def.afterLoad,
        };

        // 注册原始路由（含路由级守卫）
        framework.router.add(def.path, def.intentId, routeOpts);

        // 注册 locale 前缀路由
        if (options?.locales?.length) {
            const localePath = def.path === "/" ? "/:locale" : `/:locale${def.path}`;
            framework.router.add(localePath, def.intentId, routeOpts);
        }
    }
}
