import { type LocaleAttributes, type RuntimeHandle, type Translator } from "@finesoft/core";
import type { Action } from "../actions/types";
import type { BasePage } from "../models/page";
import type { WebSession } from "../application/session";
import type { NavigationSnapshot, ResolvedDestination } from "../navigation/types";
import type {
    NavigationScopedState,
    SessionStateProvider,
    SessionWriteResult,
} from "../session/types";

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
export interface NavigationCommands extends Pick<
    WebSession,
    | "push"
    | "pop"
    | "popToRoot"
    | "replaceTop"
    | "selectTab"
    | "selectColumn"
    | "setVisibility"
    | "reuseEntry"
    | "refresh"
    | "hydrate"
> {
    navigate(url: string): Promise<void>;
}
export interface SessionAccess {
    readonly scope: NavigationScopedState;
    register<T>(provider: SessionStateProvider<T>): () => void;
    save(): Promise<SessionWriteResult>;
    clear(): Promise<SessionWriteResult>;
}
/** Native roots consume the same view during SSR and in the browser. */
export interface WebAppView {
    readonly runtime: RuntimeHandle;
    readonly navigation: NavigationCommands;
    readonly session?: SessionAccess;
    readonly locale?: LocaleAttributes;
    readonly translator?: Translator;
    perform(this: void, action: Action): Promise<void>;
    getSnapshot(this: void): AppSnapshot;
    subscribe(this: void, listener: () => void): () => void;
    /** Called by a native post-commit hook; it never waits for session restore. */
    commit(this: void, revision: number): void;
}
export interface ViewProps<P extends BasePage = BasePage> {
    readonly page: P;
    readonly app: WebAppView;
    readonly entry: ViewEntry;
}
