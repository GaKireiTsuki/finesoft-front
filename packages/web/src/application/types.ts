import type { AppDefinition, ExecutionContext, Operation, OperationPolicy } from "@finesoft/core";
import type { WebConfiguration } from "./runtime";
import type { RouteDefinition } from "../bootstrap/define-routes";
import type { BeforeLoadGuard, AfterLoadGuard } from "../middleware/types";
import type { BasePage } from "../models/page";
import type { LeafNode, NavigationNode } from "../navigation/types";
import type { RouteParams } from "../router/types";
import type { RouteMatch } from "../router/router";

export interface PageControllerDefinition {
    readonly id: string;
    readonly create?: () => {
        perform(input: RouteParams, context: ExecutionContext): Promise<BasePage>;
    };
    readonly handler?: (
        params: RouteParams,
        context: ExecutionContext,
    ) => BasePage | Promise<BasePage>;
    readonly policies?: readonly OperationPolicy<RouteParams>[];
    readonly routes?: readonly (string | Omit<RouteDefinition, "controller" | "intentId">)[];
}
export interface NavigationTarget {
    readonly url: string;
    readonly match?: RouteMatch;
    readonly target?: LeafNode;
}
export interface WebAppDefinition {
    readonly id: string;
    readonly app?: AppDefinition;
    readonly pages: readonly PageControllerDefinition[];
    readonly navigation?:
        | NavigationNode
        | ((target: NavigationTarget) => NavigationNode | undefined);
    readonly navigationCodec?: import("../navigation/codec").NavigationCodec;
    readonly loadMessages?: import("../i18n/messages").MessagesLoader;
    readonly getErrorPage: (status: number, message: string) => BasePage;
    readonly configuration?: WebConfiguration;
    readonly beforeNavigate?: readonly import("../navigation/controller").BeforeNavigatePolicy[];
    readonly beforeCommit?: readonly import("../navigation/controller").BeforeCommitPolicy[];
    readonly beforeLoad?: readonly BeforeLoadGuard[];
    readonly afterLoad?: readonly AfterLoadGuard[];
}
export interface WebPageOperation extends Operation<RouteParams, BasePage> {}
