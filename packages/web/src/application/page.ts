import type {
    ExecutionContext,
    IntentController,
    OperationPolicy,
    ParamsFor,
    QuerySchemaMap,
} from "@finesoft/core";
import { route, type RouteDefinition } from "../bootstrap/define-routes";
import type { BasePage } from "../models/page";
import { leaf } from "../navigation/nodes";
import type { LeafNode } from "../navigation/types";
import type { RouteParams } from "../router/types";
import type { PageControllerDefinition } from "./types";

type ControllerParams<C> = C extends { execute(params: infer P, ...rest: any[]): unknown }
    ? P extends RouteParams
        ? P
        : RouteParams
    : RouteParams;
/** Reference helpers emit existing declarations. Page type, operation id and entry id stay distinct. */
export interface PageReference<
    P extends RouteParams,
    R extends BasePage,
> extends PageControllerDefinition {
    route<
        const Path extends string,
        C extends ParamsFor<Path> = ParamsFor<Path>,
        Q extends QuerySchemaMap = QuerySchemaMap,
    >(
        path: Path,
        options?: Omit<RouteDefinition<Path, C, Q>, "path" | "intentId">,
    ): Readonly<RouteDefinition<Path, C, Q>>;
    leaf(
        ...args: {} extends P
            ? [params?: P, options?: { url?: string }]
            : [params: P, options?: { url?: string }]
    ): LeafNode;
    /** Explicit result pageType association; native component prop validation belongs to the UI adapter. */
    bindView<const Type extends R["pageType"], View>(
        pageType: Type,
        view: View,
    ): Readonly<Record<Type, View>>;
}
export function definePage<C extends IntentController<BasePage>>(input: {
    readonly id: string;
    readonly create: () => C;
    readonly policies?: readonly OperationPolicy<RouteParams>[];
}): PageReference<ControllerParams<C>, Awaited<ReturnType<C["perform"]>>>;
export function definePage<P extends RouteParams, R extends BasePage>(input: {
    readonly id: string;
    readonly handler: (params: P, context: ExecutionContext) => R | Promise<R>;
    readonly policies?: readonly OperationPolicy<RouteParams>[];
}): PageReference<P, R>;
export function definePage(input: {
    readonly id: string;
    readonly create?: () => IntentController<BasePage>;
    readonly handler?: (params: any, context: ExecutionContext) => BasePage | Promise<BasePage>;
    readonly policies?: readonly OperationPolicy<RouteParams>[];
}): PageReference<RouteParams, BasePage> {
    return Object.freeze({
        ...input,
        route: (path, options) => route(path, { ...options, intentId: input.id }),
        leaf: (params = {}, options = {}) => leaf(input.id, params, options),
        bindView: (pageType, view) =>
            Object.freeze({ [pageType]: view }) as Readonly<Record<typeof pageType, typeof view>>,
    } satisfies PageReference<RouteParams, BasePage>);
}
