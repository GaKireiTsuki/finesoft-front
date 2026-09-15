import { defineApp, defineOperation, ExecutionError } from "@finesoft/core";
import type { AppDefinition, ExecutionContext, Operation } from "@finesoft/core";
import type { BasePage } from "../models/page";
import type { PrefetchedIntents } from "../prefetched-intents/prefetched-intents";
import { Router } from "../router/router";
import type { RouteParams } from "../router/types";
import type { WebAppDefinition } from "./types";

export interface WebExecutionState {
    readonly prefetched: PrefetchedIntents;
    readonly retained: WeakMap<object, BasePage>;
    readonly entryIds: WeakMap<object, string>;
}
export const WEB_EXECUTION = "@finesoft/web/execution";
export function consumePage(
    context: ExecutionContext,
    id: string,
    params: RouteParams,
): BasePage | undefined {
    const state = context.bindings[WEB_EXECUTION] as WebExecutionState | undefined;
    return (
        state?.retained.get(params) ??
        state?.prefetched.get<BasePage>({ id, params }, state.entryIds.get(params))
    );
}
interface WebPlan {
    readonly app: AppDefinition;
    readonly router: Router;
    readonly operations: ReadonlyMap<string, Operation<RouteParams, BasePage>>;
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
export function defineWebApp(input: WebAppDefinition): WebAppDefinition {
    const routes = Object.freeze(
        input.routes.map((route) => {
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
    const controllers = Object.freeze(
        (input.controllers ?? []).map((controller) => Object.freeze({ ...controller })),
    );
    const definition = Object.freeze({
        ...input,
        routes,
        controllers,
        navigation:
            typeof input.navigation === "function"
                ? input.navigation
                : input.navigation && freezeSnapshot(structuredClone(input.navigation)),
        beforeLoad: input.beforeLoad && Object.freeze([...input.beforeLoad]),
        afterLoad: input.afterLoad && Object.freeze([...input.afterLoad]),
        frameworkConfig: input.frameworkConfig && Object.freeze({ ...input.frameworkConfig }),
    });
    const operations = new Map<string, Operation<RouteParams, BasePage>>();
    for (const controller of controllers) {
        if (operations.has(controller.id) || !!controller.create === !!controller.handler)
            throw new ExecutionError("configuration", `Invalid page controller: ${controller.id}`);
        operations.set(
            controller.id,
            defineOperation({
                id: controller.id,
                kind: "query",
                policies: controller.policies,
                handler: (params, context) => {
                    const cached = consumePage(context, controller.id, params);
                    if (cached !== undefined) return cached;
                    return controller.handler
                        ? controller.handler(params, context)
                        : controller.create!().perform(
                              { id: controller.id, params },
                              context.container,
                              context,
                          );
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
    plans.set(definition, { app, router: router.seal(), operations });
    return definition;
}
