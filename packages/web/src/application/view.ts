import { type LocaleAttributes, type RuntimeHandle, type Translator } from "@finesoft/core";
import type { ActionDispatcher } from "../actions/dispatcher";
import type { BasePage } from "../models/page";
import type { NavigationSnapshot, ResolvedDestination } from "../navigation/types";
import type { SessionStore } from "../session/types";
import type { Action, ActionInvocation } from "../actions/types";
import type { AppQueries, AppParams, WebAppDefinition } from "./types";

export interface NavigationSummary {
    readonly canGoBack: boolean;
    readonly activeEntryId?: string;
    readonly tabs?: { readonly active: string; readonly order: readonly string[] };
}
export interface ViewEntry extends ResolvedDestination {
    readonly visible: boolean;
}
export interface AppSnapshot extends NavigationSnapshot {
    readonly revision: number;
    readonly entries: readonly ViewEntry[];
    readonly navigation: NavigationSummary;
}
/** Native roots consume the same view during SSR and in the browser. */
export interface WebAppView<Definition extends WebAppDefinition = WebAppDefinition> extends Pick<
    ActionDispatcher<NavigationSnapshot>,
    "onAction" | "removeAction"
> {
    perform(
        this: void,
        action: Action<AppParams<Definition>, AppQueries<Definition>>,
        invocation?: ActionInvocation,
    ): Promise<NavigationSnapshot>;
    readonly runtime: RuntimeHandle;
    readonly session?: SessionStore;
    readonly locale?: LocaleAttributes;
    readonly translator?: Translator;
    getSnapshot(this: void): AppSnapshot;
    subscribe(this: void, listener: () => void): () => void;
    /** Called by a native post-commit hook; it never waits for session restore. */
    commit(this: void, revision: number): void;
}
export interface ViewProps<
    P extends BasePage = BasePage,
    Definition extends WebAppDefinition = WebAppDefinition,
> {
    readonly page: P;
    readonly app: WebAppView<Definition>;
    readonly entry: ViewEntry;
}
