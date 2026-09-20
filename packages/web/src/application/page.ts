import type { ExecutionContext, OperationPolicy, ParamsFor, QuerySchemaMap } from "@finesoft/core";
import { route, type PageRoute, type RouteDefinition } from "../bootstrap/define-routes";
import type { BasePage } from "../models/page";
import { leaf } from "../navigation/nodes";
import type { LeafNode } from "../navigation/types";
import type { RouteParams } from "../router/types";
import type { PageControllerDefinition } from "./types";
import type { RouteInputFor, ValidRoutes } from "./route-input";

type ControllerParams<C> = C extends { execute(input: { params: infer P }): unknown }
    ? P extends RouteParams
        ? P
        : RouteParams
    : RouteParams;
/** Reference helpers emit existing declarations. Page type, operation id and entry id stay distinct. */
export interface PageReference<
    P extends RouteParams,
    R extends BasePage,
    Id extends string = string,
    Q extends RouteParams = RouteParams,
> extends PageControllerDefinition {
    readonly id: Id;
    route<const Path extends string>(path: Path): Readonly<{ path: Path; intentId: Id }>;
    route<const Path extends string, const Options extends Omit<PageRoute<Path>, "path">>(
        path: Path,
        options: Options &
            NoInfer<Record<Exclude<keyof Options, keyof Omit<PageRoute<Path>, "path">>, never>>,
    ): Readonly<{ path: Path; intentId: Id } & Options>;
    route<
        const Path extends string,
        C extends ParamsFor<Path> = ParamsFor<Path>,
        Q extends QuerySchemaMap = QuerySchemaMap,
    >(
        path: Path,
        options?: Omit<RouteDefinition<Path, C, Q>, "path" | "intentId">,
    ): Readonly<RouteDefinition<Path, C, Q>>;
    leaf(
        ...args: {} extends Q
            ? {} extends P
                ? [params?: P, options?: { url?: string; query?: Q }]
                : [params: P, options?: { url?: string; query?: Q }]
            : [params: P, options: { url?: string; query: Q }]
    ): LeafNode;
    /** Explicit result pageType association; native component prop validation belongs to the UI adapter. */
    bindView<const Type extends R["pageType"], View>(
        pageType: Type,
        view: View,
    ): Readonly<Record<Type, View>>;
}
export function definePage<
    const Id extends string,
    const Routes extends readonly (string | PageRoute)[],
    R extends BasePage,
>(input: {
    readonly id: Id;
    readonly routes: Routes & NoInfer<ValidRoutes<Routes>>;
    readonly handler: (
        params: NoInfer<RouteInputFor<Routes>["params"]>,
        context: ExecutionContext,
        query: NoInfer<RouteInputFor<Routes>["query"]>,
    ) => R | Promise<R>;
    readonly policies?: readonly OperationPolicy<NoInfer<RouteInputFor<Routes>["params"]>>[];
}): PageReference<RouteInputFor<Routes>["params"], R, Id, RouteInputFor<Routes>["query"]>;
export function definePage<
    const Id extends string,
    const Routes extends readonly (string | PageRoute)[],
    R extends BasePage,
>(input: {
    readonly id: Id;
    readonly routes: Routes & NoInfer<ValidRoutes<Routes>>;
    readonly create: () => {
        perform: (
            params: NoInfer<RouteInputFor<Routes>["params"]>,
            context: ExecutionContext,
            query: NoInfer<RouteInputFor<Routes>["query"]>,
        ) => R | Promise<R>;
    };
    readonly policies?: readonly OperationPolicy<NoInfer<RouteInputFor<Routes>["params"]>>[];
}): PageReference<RouteInputFor<Routes>["params"], R, Id, RouteInputFor<Routes>["query"]>;
export function definePage<
    const Id extends string,
    C extends { perform(input: any, context: ExecutionContext): Promise<BasePage> },
>(input: {
    readonly id: Id;
    readonly routes?: undefined;
    readonly create: () => C;
    readonly policies?: readonly OperationPolicy<RouteParams>[];
}): PageReference<ControllerParams<C>, Awaited<ReturnType<C["perform"]>>, Id>;
export function definePage<
    const Id extends string,
    P extends RouteParams,
    R extends BasePage,
>(input: {
    readonly id: Id;
    readonly routes?: undefined;
    readonly handler: (params: P, context: ExecutionContext) => R | Promise<R>;
    readonly policies?: readonly OperationPolicy<RouteParams>[];
}): PageReference<P, R, Id>;
export function definePage(input: {
    readonly id: string;
    readonly routes?: PageControllerDefinition["routes"];
    readonly create?: () => {
        perform(input: any, context: ExecutionContext, query: any): BasePage | Promise<BasePage>;
    };
    readonly handler?: (
        params: any,
        context: ExecutionContext,
        query: any,
    ) => BasePage | Promise<BasePage>;
    readonly policies?: readonly OperationPolicy<RouteParams>[];
}): PageReference<RouteParams, BasePage> {
    return Object.freeze({
        ...input,
        route: ((path: string, options?: Omit<PageRoute, "path">) =>
            route(path, { ...options, intentId: input.id })) as PageReference<
            RouteParams,
            BasePage
        >["route"],
        leaf: (params = {}, options = {}) => leaf(input.id, params, options),
        bindView: (pageType, view) =>
            Object.freeze({ [pageType]: view }) as Readonly<Record<typeof pageType, typeof view>>,
    } satisfies PageReference<RouteParams, BasePage>);
}
