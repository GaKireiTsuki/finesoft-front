import { createSSRApp, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { createNativeSSRRender } from "../server";
import type { RendererOptions } from "../types";
import type { WebAppDefinition } from "@finesoft/web";
export function createVueSSRRender(config: {
    app: WebAppDefinition;
    renderer: RendererOptions<Component>;
}) {
    return createNativeSSRRender(config, async (View, props) => ({
        html: await renderToString(createSSRApp(View, props)),
        head: "",
        css: "",
    }));
}
export { serializeServerData } from "@finesoft/ssr";
