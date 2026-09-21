import type { AppDefinition, ExecutionContext, Operation, OperationPolicy } from "@finesoft/core";
import type { WebConfiguration } from "./runtime";
import type { PageRoute } from "../bootstrap/define-routes";
import type { BeforeLoadGuard, AfterLoadGuard } from "../middleware/types";
import type { BasePage } from "../models/page";
import type { LeafNode, NavigationNode } from "../navigation/types";
import type { RouteInput, RouteParams } from "../router/types";
import type { RouteMatch } from "../router/router";
import type { ControllerContext } from "./controller-context";

export interface PageControllerDefinition {
    readonly id: string;
    readonly create?: () => {
        perform(
            input: RouteParams,
            context: ExecutionContext,
            query: RouteParams,
        ): BasePage | Promise<BasePage>;
    };
    readonly handler?: (
        params: RouteParams,
        context: ControllerContext,
        query: RouteParams,
    ) => BasePage | Promise<BasePage>;
    readonly policies?: readonly OperationPolicy<RouteParams>[];
    readonly routes?: readonly (string | PageRoute)[];
}
export interface NavigationTarget {
    readonly url: string;
    readonly match?: RouteMatch;
    readonly target?: LeafNode;
}
export interface WebAppDefinition<
    Pages extends readonly PageControllerDefinition[] = readonly PageControllerDefinition[],
> {
    readonly id: string;
    readonly app?: AppDefinition;
    readonly pages: Pages;
    /** Opt into retained structured navigation. Without it or a codec, URL navigation replaces the page. */
    readonly navigation?:
        | NavigationNode
        | ((target: NavigationTarget) => NavigationNode | undefined);
    readonly navigationCodec?: import("../navigation/codec").NavigationCodec;
    readonly loadMessages?: import("../i18n/messages").MessagesLoader;
    readonly getErrorPage: (status: number, message: string) => BasePage;
    readonly configuration?: WebConfiguration;
    readonly beforeNavigate?: readonly import("../application/session").BeforeNavigatePolicy[];
    readonly beforeCommit?: readonly import("../application/session").BeforeCommitPolicy[];
    readonly beforeLoad?: readonly BeforeLoadGuard[];
    readonly afterLoad?: readonly AfterLoadGuard[];
}
export interface WebPageOperation extends Operation<RouteInput, BasePage> {}

type PageInput<P> = P extends { leaf: (...args: infer A) => unknown }
    ? NonNullable<A[0]> extends RouteParams
        ? NonNullable<A[0]>
        : RouteParams
    : P extends { handler: (params: infer Input, ...rest: any[]) => unknown }
      ? Input extends RouteParams
          ? Input
          : RouteParams
      : RouteParams;
/** Structural metadata; no runtime registry or cross-package private brand. */
export type AppParams<Definition extends WebAppDefinition> = {
    [P in Definition["pages"][number] as P["id"]]: PageInput<P>;
};

export type AppQueries<Definition extends WebAppDefinition> = {
    [P in Definition["pages"][number] as P["id"]]: P extends { leaf: (...args: infer A) => unknown }
        ? NonNullable<A[1]> extends { query?: infer Q extends RouteParams }
            ? Q
            : RouteParams
        : RouteParams;
};
