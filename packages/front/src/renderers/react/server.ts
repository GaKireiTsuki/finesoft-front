import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createNativeSSRRender } from "../server";
import type { RendererOptions } from "../types";
import type { WebAppDefinition } from "@finesoft/web";
export function createReactSSRRender(config: {
    app: WebAppDefinition;
    renderer: RendererOptions<ComponentType<any>>;
}) {
    return createNativeSSRRender(config, async (View, props) => ({
        html: renderToString(
            createElement("div", { style: { display: "contents" } }, createElement(View, props)),
        ),
        head: "",
        css: "",
    }));
}
export { serializeServerData } from "@finesoft/ssr";
