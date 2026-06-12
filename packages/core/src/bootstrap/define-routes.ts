/**
 * defineRoutes — 声明式路由 + Controller 注册
 *
 * 将命令式的路由注册 (20+ 行 framework.router.add / framework.registerIntent)
 * 简化为声明式配置数组。
 */

import type { Container } from "../dependencies/container";
import type { Framework } from "../framework";
import type { IntentController } from "../intents/types";
import type { AfterLoadGuard, BeforeLoadGuard } from "../middleware/types";
import type {
    ExtractParamNames,
    InferParams,
    InferQuery,
    ParamSchema,
    ParamsFor,
    QuerySchemaMap,
} from "../router/params";

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

/** defineRoute 的 handler 入参类型：path 参数 + query 经 codec 推导后合并（免手写）。 */
type HandlerParams<P, Q> = InferParams<{
    [K in keyof P]: P[K] extends ParamSchema ? P[K] : never;
}> &
    InferQuery<{
        [K in keyof Q]: Q[K] extends QuerySchemaMap[string] ? Q[K] : never;
    }>;

/**
 * 构造一条强类型路由定义，**handler 的入参类型从 `path` + codec 自动推导**——免手写
 * `BaseController<InferParams<typeof ...> & InferQuery<typeof ...>>`。
 *
 * 与 `route()`（类 controller）互补：用 handler 函数代替 `BaseController` 子类，框架据
 * `params`/`query` codec 自动算出 handler 入参类型；内部把 handler 合成为 `IntentController`，
 * 复刻 `BaseController` 的 try/catch → fallback 行为。`params` 的 key 同样受 `path` 字面量约束。
 *
 * @example
 * route 同款的强类型，但无需声明 controller 类：
 * ```ts
 * defineRoute("/product/:id", {
 *   intentId: "product",
 *   params: { id: int() },
 *   query: { page: withDefault(int(), 1) },
 *   handler: (params) => ({ ... }),   // params: { id: number; page: number }，自动推导
 * })
 * ```
 */
export function defineRoute<
    const Path extends string,
    P extends ParamsFor<Path> = ParamsFor<Path>,
    Q extends QuerySchemaMap = QuerySchemaMap,
    TResult = unknown,
>(
    path: Path,
    def: {
        intentId: string;
        params?: P;
        query?: Q;
        handler: (params: HandlerParams<P, Q>, container: Container) => TResult | Promise<TResult>;
        fallback?: (params: HandlerParams<P, Q>, error: Error) => TResult | Promise<TResult>;
        renderMode?: RenderMode;
        beforeLoad?: BeforeLoadGuard[];
        afterLoad?: AfterLoadGuard[];
    },
): RouteDefinition {
    const controller: IntentController<TResult> = {
        intentId: def.intentId,
        async perform(intent, container) {
            const params = (intent.params ?? {}) as HandlerParams<P, Q>;
            try {
                return await def.handler(params, container);
            } catch (e) {
                const error = e instanceof Error ? e : new Error(String(e));
                if (def.fallback) return def.fallback(params, error);
                throw error;
            }
        },
    };
    return {
        path,
        intentId: def.intentId,
        controller,
        params: def.params,
        query: def.query,
        renderMode: def.renderMode,
        beforeLoad: def.beforeLoad,
        afterLoad: def.afterLoad,
    } as RouteDefinition;
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
 * 数组形态 6c 一致性的载体：把一条路由的 `params` 按其自身 `path` 字面量重新约束 key。
 *
 * 不在 path 参数名集合内的 key 显式映射为 `never`——结构化赋值不会对非 fresh 对象做
 * excess-property 检查（`route()` 单数 helper 靠 fresh 字面量 + `ParamsFor` 拿到 excess
 * 检查，但数组元素流经泛型推断后不再是 fresh，故改用 never 映射），使其值（`ParamSchema`）
 * 不可赋给 `never` 而编译期报错。
 */
type ValidateRouteParams<Path extends string, Params> = {
    [K in keyof Params]: K extends ExtractParamNames<Path> ? Params[K] : never;
};

/**
 * 仅当元素是「带 params 的对象字面量」时重写其 params 约束；无 params 的路由与 `route()`
 * 输出（`params` 可选、Path 已擦除为 string）走 false 分支，原样透传、不被过度约束。
 */
type ValidateRouteDef<R> = R extends { path: infer P extends string; params: infer Params }
    ? Omit<R, "params"> & { params: ValidateRouteParams<P, Params> }
    : R;

/**
 * 声明式注册路由和 Controller
 *
 * - 自动去重: 同一 intentId 的 controller 只注册一次
 * - 路由和 controller 在同一个配置数组中，方便检查一致性
 * - **数组形态 6c**: 每条对象字面量路由的 `params` key 受其自身 `path` 字面量约束，
 *   写入 path 中不存在的参数名会编译期报错（与 `route()` 单数 helper 同等保证）。
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
export function defineRoutes<const T extends readonly RouteDefinition[]>(
    framework: Framework,
    definitions: { [I in keyof T]: ValidateRouteDef<T[I]> },
    options?: DefineRoutesOptions,
): void {
    const registeredIntents = new Set<string>();

    for (const def of definitions as readonly RouteDefinition[]) {
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
