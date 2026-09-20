import {
    createElement,
    useLayoutEffect,
    useSyncExternalStore,
    type ComponentType,
    type ReactNode,
} from "react";
import type { ViewProps, WebAppView } from "@finesoft/web";

/** Views choose their own page subtype; Outlet supplies the common runtime props. */
export type NativeView = ComponentType<never>;
export type NativeViews = Readonly<Record<string, NativeView>>;

export function useSnapshot(app: WebAppView) {
    return useSyncExternalStore(
        app.subscribe,
        () => app.getSnapshot(),
        () => app.getSnapshot(),
    );
}

export function Outlet({
    app,
    views,
}: {
    readonly app: WebAppView;
    readonly views: NativeViews;
}): ReactNode {
    const snapshot = useSnapshot(app);
    useLayoutEffect(() => app.commit(snapshot.revision), [app, snapshot.revision]);
    return createElement(
        "main",
        { "data-fs-outlet": "" },
        snapshot.entries.map((entry) => {
            const View = views[entry.page.pageType] ?? views["*"];
            if (!View) throw Error("Missing view: " + entry.page.pageType);
            return createElement(
                "div",
                {
                    key: entry.entryId,
                    hidden: !entry.visible,
                    "data-fs-entry": entry.entryId,
                    "data-fs-key": entry.entryId,
                    "data-fs-intent": entry.intent,
                },
                createElement(View as ComponentType<ViewProps>, {
                    key: entry.entryId + ":" + entry.page.pageType,
                    page: entry.page,
                    app,
                    entry,
                }),
            );
        }),
    );
}

export type { ViewProps, WebAppView };
