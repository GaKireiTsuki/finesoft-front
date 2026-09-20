import type { Component } from "svelte";
import type { WebAppView } from "@finesoft/web";
declare const Outlet: Component<{
    app: WebAppView;
    views: Readonly<Record<string, Component<never>>>;
}>;
export default Outlet;
