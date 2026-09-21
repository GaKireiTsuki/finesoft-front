import { loadImplementation } from "#finesoft/implementation";
import type { NativeAPI } from "./native-contract";
import type * as ReactBinding from "./react";
import type * as VueBinding from "./vue";
import type * as SvelteBinding from "./svelte";

export interface NativeBindings {
    react: typeof ReactBinding;
    vue: typeof VueBinding;
    svelte: typeof SvelteBinding;
}
export type Renderer = keyof NativeBindings;
export type NativeView<R extends Renderer> = R extends "react"
    ? ReactBinding.NativeView
    : R extends "vue"
      ? VueBinding.NativeView
      : SvelteBinding.NativeView;
export type NativeViews<R extends Renderer> = Readonly<Record<string, NativeView<R>>>;

function binding(renderer: Renderer): NativeBindings[Renderer] {
    if (renderer !== "react" && renderer !== "vue" && renderer !== "svelte")
        throw TypeError(`Unknown native renderer: ${String(renderer)}`);
    return loadImplementation(renderer);
}

/** Select once, outside rendering, to retain native component identity and local state. */
export const Outlet: NativeAPI<NativeBindings>["Outlet"] = (renderer) =>
    binding(renderer).Outlet as NativeBindings[typeof renderer]["Outlet"];

/** Uses the selected framework's native subscription and cleanup lifetime. */
export const useSnapshot: NativeAPI<NativeBindings>["useSnapshot"] = (renderer, app) =>
    binding(renderer).useSnapshot(app) as ReturnType<
        NativeBindings[typeof renderer]["useSnapshot"]
    >;
