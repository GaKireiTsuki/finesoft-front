/**
 * defineRoutes — 声明式路由 + Controller 注册
 *
 * 将命令式的路由注册 (20+ 行 framework.router.add / framework.registerIntent)
 * 简化为声明式配置数组。
 */

import type { Framework } from "../framework";
import type { IntentController } from "../intents/types";
import type { AfterLoadGuard, BeforeLoadGuard } from "../middleware/types";
import type { ParamSchema, ParamsFor, QuerySchemaMap } from "../router/params";

/** 渲染模式 */
export type RenderMode = "ssr" | "csr" | "prerender";

/** 单条路由定义 */
export interface RouteDefinition<
    Path extends string = string,
    P extends ParamsFor<Path> = ParamsFor<Path>,
    Q extends QuerySchemaMap = QuerySchemaMap,
> {
    /** URL pattern (如 "/product/:id") */
    path: Path;
    /** Intent ID */
    intentId: string;
    /** Controller 实例（可选）。同一 intentId 的多条路由只需在第一条提供。 */
    controller?: IntentController;
    /** path 参数 codec；key 必须是 path 中出现的 :param 名 */
    params?: P;
    /** query 参数 codec；key 自由 */
    query?: Q;
    /** 渲染模式（可选，默认 "ssr"） */
    renderMode?: RenderMode;
    /** 路由级 beforeLoad 守卫 */
    beforeLoad?: BeforeLoadGuard[];
    /** 路由级 afterLoad 守卫 */
    afterLoad?: AfterLoadGuard[];
}

/**
 * 构造一条强类型路由定义。
 * `params` 的 key 受 `path` 字面量约束——写入 path 中不存在的参数名会编译期报错。
 *
 * @example
 * route("/product/:id", { intentId: "product", controller, params: { id: int() } })
 */
export function route<
    const Path extends string,
    P extends ParamsFor<Path> = ParamsFor<Path>,
    Q extends QuerySchemaMap = QuerySchemaMap,
>(
    path: Path,
    def: {
        intentId: string;
        controller?: IntentController;
        params?: P;
        query?: Q;
        renderMode?: RenderMode;
        beforeLoad?: BeforeLoadGuard[];
        afterLoad?: AfterLoadGuard[];
    },
): RouteDefinition {
    return { path, ...def } as RouteDefinition;
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
            paramCodecs: def.params as Record<string, ParamSchema> | undefined,
            queryCodecs: def.query,
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
