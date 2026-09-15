import { render } from "svelte/server";
import type { Component } from "svelte";
import { createNativeSSRRender } from "../server";
import type { RendererOptions } from "../types";
import type { WebAppDefinition } from "@finesoft/web";
export function createSvelteSSRRender(config: {
    app: WebAppDefinition;
    renderer: RendererOptions<Component<any>>;
}) {
    return createNativeSSRRender(config, async (View, props) => {
        const result = render(View, { props });
        return { html: result.body, head: result.head, css: "" };
    });
}
export { serializeServerData } from "@finesoft/ssr";
