import type {
    AppDefinition,
    ExecutionContext,
    IntentController,
    Operation,
    OperationPolicy,
} from "@finesoft/core";
import type { FrameworkConfig } from "../framework";
import type { RouteDefinition } from "../bootstrap/define-routes";
import type { BeforeLoadGuard, AfterLoadGuard } from "../middleware/types";
import type { BasePage } from "../models/page";
import type { NavigationNode } from "../navigation/types";
import type { RouteParams } from "../router/types";

/** Reusable declarations never contain a mutable controller instance. */
export interface PageControllerDefinition {
    readonly id: string;
    readonly create?: () => IntentController<BasePage>;
    readonly handler?: (
        params: RouteParams,
        context: ExecutionContext,
    ) => BasePage | Promise<BasePage>;
    readonly policies?: readonly OperationPolicy<RouteParams>[];
}
export interface WebAppDefinition {
    readonly id: string;
    readonly app?: AppDefinition;
    readonly controllers?: readonly PageControllerDefinition[];
    readonly routes: readonly Omit<RouteDefinition, "controller">[];
    readonly navigation?: NavigationNode | ((url: string) => NavigationNode | undefined);
    readonly navigationCodec?: import("../navigation/codec").NavigationCodec;
    readonly loadMessages?: import("../i18n/messages").MessagesLoader;
    readonly getErrorPage: (status: number, message: string) => BasePage;
    readonly frameworkConfig?: Omit<
        FrameworkConfig,
        "definition" | "runtime" | "invocation" | "router" | "prefetchedIntents" | "setupRoutes"
    >;
    readonly beforeLoad?: readonly BeforeLoadGuard[];
    readonly afterLoad?: readonly AfterLoadGuard[];
}
export interface WebPageOperation extends Operation<RouteParams, BasePage> {}
