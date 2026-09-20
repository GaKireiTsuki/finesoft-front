import type { NavigationNode, NavigationPath, SplitVisibility } from "../navigation/types";
import type { RouteParams } from "../router/types";

/** Action Kind 常量 */
export const ACTION_KINDS = {
    FLOW: "flow" as const,
    EXTERNAL_URL: "externalUrl" as const,
    COMPOUND: "compound" as const,
    PUSH: "push" as const,
    POP: "pop" as const,
    POP_TO_ROOT: "popToRoot" as const,
    POP_TO: "popTo" as const,
    REPLACE_TOP: "replaceTop" as const,
    SELECT_TAB: "selectTab" as const,
    SELECT_COLUMN: "selectColumn" as const,
    SET_VISIBILITY: "setVisibility" as const,
    HYDRATE: "hydrate" as const,
    REUSE_ENTRY: "reuseEntry" as const,
    REFRESH: "refresh" as const,
};

/** FlowAction — SPA 导航 */
export interface FlowAction {
    kind: typeof ACTION_KINDS.FLOW;
    url: string;
    /** 默认按应用的路由模型导航；modal 使用独立页面会话。 */
    presentationContext?: "default" | "modal";
}

/** ExternalUrlAction — 外部链接 */
export interface ExternalUrlAction {
    kind: typeof ACTION_KINDS.EXTERNAL_URL;
    url: string;
}

/** CompoundAction — 组合 Action */
export interface CompoundAction<
    Params extends Record<string, RouteParams> = Record<string, RouteParams>,
    Queries extends Record<string, RouteParams> = Record<string, RouteParams>,
> {
    kind: typeof ACTION_KINDS.COMPOUND;
    actions: Action<Params, Queries>[];
}

type InputField<P extends RouteParams, Key extends string> = {} extends P
    ? { readonly [K in Key]?: P }
    : { readonly [K in Key]: P };
type PageAction<
    Params extends Record<string, RouteParams>,
    Queries extends Record<string, RouteParams>,
> = {
    [Id in keyof Params & string]: InputField<Params[Id], "params"> &
        InputField<Queries[Id], "query"> &
        (
            | {
                  readonly kind: "push" | "replaceTop";
                  readonly intent: Id;
                  readonly target?: NavigationPath;
                  readonly url?: string;
              }
            | {
                  readonly kind: "selectColumn";
                  readonly columnId: string;
                  readonly intent: Id;
                  readonly target?: NavigationPath;
              }
        );
}[keyof Params & string];

/** Structured actions share the same dispatcher and guarded commit as URL actions. */
export type TreeAction<
    Params extends Record<string, RouteParams> = Record<string, RouteParams>,
    Queries extends Record<string, RouteParams> = Record<string, RouteParams>,
> =
    | PageAction<Params, Queries>
    | { readonly kind: "pop"; readonly count?: number; readonly target?: NavigationPath }
    | { readonly kind: "popToRoot"; readonly target?: NavigationPath }
    | { readonly kind: "popTo"; readonly index: number; readonly target?: NavigationPath }
    | { readonly kind: "selectTab"; readonly key: string; readonly target?: NavigationPath }
    | {
          readonly kind: "selectColumn";
          readonly columnId: string;
          readonly intent: undefined;
          readonly params?: never;
          readonly target?: NavigationPath;
      }
    | {
          readonly kind: "setVisibility";
          readonly visibility: SplitVisibility;
          readonly target?: NavigationPath;
      }
    | { readonly kind: "hydrate"; readonly tree: NavigationNode }
    | { readonly kind: "reuseEntry"; readonly entryId: string }
    | { readonly kind: "refresh" };

export type Action<
    Params extends Record<string, RouteParams> = Record<string, RouteParams>,
    Queries extends Record<string, RouteParams> = Record<string, RouteParams>,
> = FlowAction | TreeAction<Params, Queries> | ExternalUrlAction | CompoundAction<Params, Queries>;
export interface ActionInvocation {
    readonly signal?: AbortSignal;
}

// ===== Type Guards =====

export function isFlowAction(action: Action): action is FlowAction {
    return action.kind === ACTION_KINDS.FLOW;
}

export function isExternalUrlAction(action: Action): action is ExternalUrlAction {
    return action.kind === ACTION_KINDS.EXTERNAL_URL;
}

export function isCompoundAction(action: Action): action is CompoundAction {
    return action.kind === ACTION_KINDS.COMPOUND;
}

// ===== Factory =====

export function makeFlowAction(
    url: string,
    presentationContext?: FlowAction["presentationContext"],
): FlowAction {
    return { kind: ACTION_KINDS.FLOW, url, presentationContext };
}

export function makeExternalUrlAction(url: string): ExternalUrlAction {
    return { kind: ACTION_KINDS.EXTERNAL_URL, url };
}
