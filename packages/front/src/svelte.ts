import type { Component } from "svelte";
import type { ViewProps, WebAppView } from "@finesoft/web";
export { default as Outlet } from "./Outlet.svelte";
/** Views choose their page subtype; Outlet supplies the common runtime props. */
export type NativeView = Component<never>;
export type NativeViews = Readonly<Record<string, NativeView>>;
/** Svelte components consume this small store with `$snapshot`. */
export function useSnapshot(app: WebAppView) {
    return {
        subscribe(run: (value: ReturnType<WebAppView["getSnapshot"]>) => void) {
            run(app.getSnapshot());
            return app.subscribe(() => run(app.getSnapshot()));
        },
    };
}
export type { ViewProps, WebAppView };
