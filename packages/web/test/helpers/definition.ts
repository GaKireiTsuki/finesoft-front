import type { IntentController } from "@finesoft/core";
import { defineWebApp } from "../../src/application/definition";
import type { BasePage } from "../../src/models/page";
import type { WebAppDefinition } from "../../src/application/types";

/** Assemble stateless test doubles as definition-owned factories before creating a Runtime. */
export function fixtureDefinition(
    routes: readonly (WebAppDefinition["routes"][number] & {
        controller?: IntentController<BasePage>;
    })[] = [],
): WebAppDefinition {
    const implementations = new Map<string, IntentController<BasePage>>();
    for (const route of routes)
        if (route.controller) implementations.set(route.intentId, route.controller);
    return defineWebApp({
        id: "fixture",
        controllers: [...implementations].map(([id, implementation]) => ({
            id,
            create: () => ({ intentId: id, perform: implementation.perform.bind(implementation) }),
        })),
        routes: routes.map(({ controller: _controller, ...route }) => route),
        getErrorPage: (status, message) => ({
            id: String(status),
            pageType: "error",
            title: message,
        }),
    });
}
