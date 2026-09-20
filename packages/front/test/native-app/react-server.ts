import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { createSSRRender, serializeServerData } from "@finesoft/front/ssr";
import ReactApp from "./ReactApp.tsx";
import { definition } from "./definition";
export async function render(url: string, structured = false) {
    const factory = createSSRRender({
        definition: definition("en", "first", { pageType: "probe" }, structured),
        render: (app) => renderToString(createElement(ReactApp, { app })),
    });
    try {
        const result = await factory(url);
        return { ...result, serialized: serializeServerData(result.serverData) };
    } finally {
        await factory.dispose();
    }
}
