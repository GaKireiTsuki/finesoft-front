import type { WebAppView } from "@finesoft/web";

export interface NativeBinding {
    readonly Outlet: unknown;
    useSnapshot(app: WebAppView): unknown;
}

/** One shared signature for the published API and project-specific declarations. */
export interface NativeAPI<Bindings extends { [K in keyof Bindings]: NativeBinding }> {
    Outlet<R extends keyof Bindings>(renderer: R): Bindings[R]["Outlet"];
    useSnapshot<R extends keyof Bindings>(
        renderer: R,
        app: WebAppView,
    ): ReturnType<Bindings[R]["useSnapshot"]>;
}
