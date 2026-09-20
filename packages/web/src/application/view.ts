import type { LocaleAttributes, RuntimeHandle, Translator } from "@finesoft/core";
import type { BasePage } from "../models/page";
import type { NavigationController } from "../navigation/controller";
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
    NavigationController,
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

import { collectAllLeaves, visibleSplitColumns } from "../navigation/operations";
import { leaf, stack } from "../navigation/nodes";
import { resourceKey } from "../navigation/keys";
import type { NavigationNode } from "../navigation/types";
import type { WebRuntime } from "./runtime";

function summarize(tree: NavigationNode): NavigationSummary {
    let node: NavigationNode | undefined = tree;
    let canGoBack = false;
    let tabs: NavigationSummary["tabs"];
    while (node) {
        if (node.kind === "leaf") return { canGoBack, tabs, activeEntryId: node.entryId };
        if (node.kind === "stack") {
            canGoBack ||= node.entries.length > 1;
            node = node.entries.at(-1);
        } else if (node.kind === "tabs") {
            tabs = { active: node.active, order: node.order };
            node = node.branches[node.active];
        } else node = visibleSplitColumns(node).at(-1)?.content;
    }
    return { canGoBack, tabs };
}
/** Presentation references are derived from the navigation owner's retained results. */
export function createAppView(options: {
    web: WebRuntime;
    controller: NavigationController;
    navigate: (url: string) => Promise<void>;
    commit?: (revision: number) => void;
    session?: () => SessionAccess | undefined;
}) {
    const { web, controller } = options;
    let revision = 0;
    let snapshot: AppSnapshot;
    const listeners = new Set<() => void>();
    function present(next = controller.getSnapshot()) {
        // Hosts may present an initial denial, but never expose its rejected candidate pages.
        if (next.rejection) {
            const { status, message } = next.rejection;
            const error = leaf("@finesoft/error");
            next = {
                tree: stack(error),
                destinations: [
                    {
                        ...error,
                        resourceKey: resourceKey(error.intent, error.params),
                        page: web.definition.getErrorPage(status, message),
                        status,
                    },
                ],
            };
        }
        const presentIds = new Set(collectAllLeaves(next.tree).map((entry) => entry.entryId));
        const visible = new Set(next.destinations.map((entry) => entry.entryId));
        const resolved = new Map(controller.getEntries().map((entry) => [entry.entryId, entry]));
        for (const entry of next.destinations) resolved.set(entry.entryId, entry);
        const previous = new Map(snapshot?.entries.map((entry) => [entry.entryId, entry]));
        // Existing wrappers keep their parent position while their visibility changes.
        const order = new Set([
            ...(snapshot?.entries.map((e) => e.entryId) ?? []),
            ...resolved.keys(),
        ]);
        const entries: ViewEntry[] = [];
        for (const id of order) {
            const entry = resolved.get(id);
            if (!presentIds.has(id) || !entry) continue;
            const old = previous.get(id);
            entries.push(
                old &&
                    old.page === entry.page &&
                    old.visible === visible.has(id) &&
                    old.resourceKey === entry.resourceKey
                    ? old
                    : Object.freeze({ ...entry, visible: visible.has(id) }),
            );
        }
        snapshot = Object.freeze({
            ...next,
            revision: ++revision,
            entries: Object.freeze(entries),
            navigation: summarize(next.tree),
        });
        for (const listener of listeners) {
            try {
                const result: unknown = listener();
                if (result && typeof (result as Promise<unknown>).then === "function")
                    void Promise.resolve(result).catch(() =>
                        web.runtime.record("view.observer-error", { revision }),
                    );
            } catch {
                web.runtime.record("view.observer-error", { revision });
            }
        }
    }
    present();
    const unsubscribe = controller.subscribe(present);
    const view: WebAppView = {
        runtime: web.runtime,
        navigation: {
            push: (...args) => controller.push(...args),
            pop: (...args) => controller.pop(...args),
            popToRoot: () => controller.popToRoot(),
            replaceTop: (...args) => controller.replaceTop(...args),
            selectTab: (...args) => controller.selectTab(...args),
            selectColumn: (...args) => controller.selectColumn(...args),
            setVisibility: (...args) => controller.setVisibility(...args),
            reuseEntry: (id) => controller.reuseEntry(id),
            refresh: () => controller.refresh(),
            hydrate: (tree) => controller.hydrate(tree),
            navigate: options.navigate,
        },
        get session() {
            return options.session?.();
        },
        get locale() {
            return web.getLocale();
        },
        get translator() {
            return web.getTranslator();
        },
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        commit: (value) => {
            if (value === snapshot.revision) options.commit?.(value);
        },
    };
    return {
        view,
        present,
        dispose: () => {
            unsubscribe();
            listeners.clear();
        },
    };
}
