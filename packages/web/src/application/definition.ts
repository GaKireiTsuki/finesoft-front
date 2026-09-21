import { defineApp, defineOperation, ExecutionError } from "@finesoft/core";
import type { AppDefinition, ExecutionContext, Operation } from "@finesoft/core";
import type { BasePage } from "../models/page";
import type { PrefetchedIntents } from "../prefetched-intents/prefetched-intents";
import { Router } from "../router/router";
import { routeIntent, type RouteInput } from "../router/types";
import type { PageControllerDefinition, WebAppDefinition } from "./types";
import type { RouteDefinition } from "../bootstrap/define-routes";
import {
    SERVER_REQUEST,
    SERVER_CONTROLLER,
    controllerContext,
    type ControllerContext,
    type ServerRequestState,
} from "./controller-context";

export interface WebExecutionState {
    prefetched: PrefetchedIntents;
    readonly retained: WeakMap<object, BasePage>;
    readonly entryIds: WeakMap<object, string>;
    readonly contexts: WeakMap<object, ControllerContext>;
}
export const WEB_EXECUTION = "@finesoft/web/execution";
export function consumePage(
    context: ExecutionContext,
    id: string,
    input: RouteInput,
): BasePage | undefined {
    const state = context.bindings[WEB_EXECUTION] as WebExecutionState | undefined;
    return (
        state?.retained.get(input) ??
        state?.prefetched.get<BasePage>(
            routeIntent<BasePage>(id, input.params, input.query),
            state.entryIds.get(input),
        )
    );
}
interface WebPlan {
    readonly app: AppDefinition;
    readonly router: Router;
    readonly routes: readonly RouteDefinition[];
    readonly operations: ReadonlyMap<string, Operation<RouteInput, BasePage>>;
}
const plans = new WeakMap<WebAppDefinition, WebPlan>();
export function getWebPlan(definition: WebAppDefinition): WebPlan {
    const plan = plans.get(definition);
    if (!plan)
        throw new ExecutionError(
            "configuration",
            "Use defineWebApp to assemble the Web definition",
        );
    return plan;
}
function freezeSnapshot<T>(value: T): T {
    if (value && typeof value === "object") {
        for (const child of Object.values(value)) freezeSnapshot(child);
        Object.freeze(value);
    }
    return value;
}
export function defineWebApp<const Pages extends readonly PageControllerDefinition[]>(
    input: WebAppDefinition<Pages>,
): WebAppDefinition<Pages>;
export function defineWebApp(input: WebAppDefinition): WebAppDefinition {
    const routes = Object.freeze(
        input.pages
            .flatMap((page) =>
                (page.routes ?? []).map((route) => ({
                    ...(typeof route === "string" ? { path: route } : route),
                    intentId: page.id,
                })),
            )
            .map((route) => {
                if ("controller" in route)
                    throw new ExecutionError(
                        "configuration",
                        "Web routes reference controller factories by intentId",
                    );
                return Object.freeze({
                    ...route,
                    beforeLoad:
                        route.beforeLoad &&
                        (Object.freeze([...route.beforeLoad]) as typeof route.beforeLoad),
                    afterLoad:
                        route.afterLoad &&
                        (Object.freeze([...route.afterLoad]) as typeof route.afterLoad),
                });
            }),
    );
    const pages = Object.freeze(input.pages.map((controller) => Object.freeze({ ...controller })));
    const definition = Object.freeze({
        ...input,
        pages,
        navigation:
            typeof input.navigation === "function"
                ? input.navigation
                : input.navigation && freezeSnapshot(structuredClone(input.navigation)),
        beforeNavigate: input.beforeNavigate && Object.freeze([...input.beforeNavigate]),
        beforeCommit: input.beforeCommit && Object.freeze([...input.beforeCommit]),
        beforeLoad: input.beforeLoad && Object.freeze([...input.beforeLoad]),
        afterLoad: input.afterLoad && Object.freeze([...input.afterLoad]),
        configuration: input.configuration && Object.freeze({ ...input.configuration }),
    });
    const operations = new Map<string, Operation<RouteInput, BasePage>>();
    for (const controller of pages) {
        if (operations.has(controller.id) || !!controller.create === !!controller.handler)
            throw new ExecutionError("configuration", `Invalid page controller: ${controller.id}`);
        operations.set(
            controller.id,
            defineOperation({
                id: controller.id,
                kind: "query",
                policies: controller.policies?.map(
                    (policy) => (input: RouteInput, context: ExecutionContext) =>
                        policy(input.params, context),
                ),
                handler: (input, context) => {
                    const state = context.bindings[WEB_EXECUTION] as WebExecutionState | undefined;
                    const request = context.bindings[SERVER_REQUEST] as
                        | ServerRequestState
                        | undefined;
                    const current =
                        state?.contexts.get(input) ??
                        controllerContext(context, {
                            url: "",
                            path: "",
                            intent: routeIntent(controller.id, input.params, input.query),
                            isServer: !!request || typeof window === "undefined",
                            getCookie: () => undefined,
                            getHeader: (name) => request?.request.headers.get(name) ?? undefined,
                        });
                    const cached = consumePage(context, controller.id, input);
                    if (cached !== undefined) return cached;
                    const instance = controller.create?.();
                    if (request?.remote && (!instance || !(SERVER_CONTROLLER in instance)))
                        throw new ExecutionError("not_found");
                    if (controller.handler)
                        return controller.handler(input.params, current, input.query);
                    return instance!.perform(input.params, current, input.query);
                },
            }),
        );
    }
    const router = new Router();
    const paths = new Set<string>();
    for (const route of routes) {
        if (paths.has(route.path))
            throw new ExecutionError("configuration", `Duplicate route: ${route.path}`);
        if (!operations.has(route.intentId))
            throw new ExecutionError("configuration", `Unknown page: ${route.intentId}`);
        paths.add(route.path);
        router.add(route.path, route.intentId, {
            renderMode: route.renderMode,
            cache: route.cache,
            beforeGuards: route.beforeLoad,
            afterGuards: route.afterLoad,
            paramCodecs: route.params,
            queryCodecs: route.query,
        });
    }
    const app = defineApp({
        ...input.app,
        id: input.id,
        operations: [...(input.app?.operations ?? []), ...operations.values()],
    });
    plans.set(definition, { app, router: router.seal(), operations, routes });
    return definition;
}
