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
export function defineRoutes(framework: Framework, definitions: RouteDefinition[]): void {
    const registeredIntents = new Set<string>();

    for (const def of definitions) {
        // 注册 Controller（每个 intentId 只注册一次）
        if (def.controller && !registeredIntents.has(def.intentId)) {
            framework.registerIntent(def.controller);
            registeredIntents.add(def.intentId);
        }

        // 注册路由（含路由级守卫）
        framework.router.add(def.path, def.intentId, {
            renderMode: def.renderMode,
            beforeGuards: def.beforeLoad,
            afterGuards: def.afterLoad,
        });
    }
}
