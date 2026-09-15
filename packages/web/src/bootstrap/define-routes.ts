import type { AfterLoadGuard, BeforeLoadGuard } from "../middleware/types";
import type { ParamsFor, QuerySchemaMap } from "@finesoft/core";

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
    /** path 参数 codec；key 必须是 path 中出现的 :param 名 */
    params?: P;
    /** query 参数 codec；key 自由 */
    query?: Q;
    /** 渲染模式（可选，默认 "ssr"） */
    cache?: "public";
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
 * route("/product/:id", { intentId: "product", params: { id: int() } })
 */
export function route<
    const Path extends string,
    P extends ParamsFor<Path> = ParamsFor<Path>,
    Q extends QuerySchemaMap = QuerySchemaMap,
>(
    path: Path,
    def: {
        intentId: string;
        params?: P;
        query?: Q;
        cache?: "public";
        renderMode?: RenderMode;
        beforeLoad?: BeforeLoadGuard[];
        afterLoad?: AfterLoadGuard[];
    },
): Readonly<RouteDefinition<Path, P, Q>> {
    return Object.freeze({ path, ...def });
}
