import type { ExecutionContext, Intent } from "@finesoft/core";
import { defineWebApp } from "../../src/application/definition";
import type { BasePage } from "../../src/models/page";
import type { WebAppDefinition, PageControllerDefinition } from "../../src/application/types";
import type { RouteDefinition } from "../../src/bootstrap/define-routes";

/** Table-driven tests associate routes with their owning page declarations. */
export function routePages(
    pages: readonly PageControllerDefinition[],
    routes: readonly RouteDefinition[],
): PageControllerDefinition[] {
    return pages.map((page) => ({
        ...page,
        routes: routes
            .filter((route) => route.intentId === page.id)
            .map(({ intentId: _id, ...route }) => route),
    }));
}

export interface FixtureController {
    readonly intentId: string;
    perform(
        intent: Intent,
        container?: ExecutionContext["container"],
        context?: ExecutionContext,
    ): BasePage | Promise<BasePage>;
}

/** Assemble stateless test doubles as definition-owned factories before creating a Runtime. */
export function fixtureDefinition(
    routes: readonly (RouteDefinition & {
        controller?: FixtureController;
    })[] = [],
): WebAppDefinition {
    const implementations = new Map<string, FixtureController>();
    for (const route of routes)
        if (route.controller) implementations.set(route.intentId, route.controller);
    return defineWebApp({
        id: "fixture",
        pages: routePages(
            [...implementations].map(([id, implementation]) => ({
                id,
                handler: (params, context) =>
                    implementation.perform({ id, params }, context.container, context),
            })),
            routes.map(({ controller: _controller, ...route }) => route),
        ),
        getErrorPage: (status, message) => ({
            id: String(status),
            pageType: "error",
            title: message,
        }),
    });
}
