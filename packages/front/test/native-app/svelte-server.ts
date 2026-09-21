import { render as renderSvelte } from "svelte/server";
import { createSSRRender, serializeServerData } from "@finesoft/front";
import App from "./SvelteApp.svelte";
import { definition } from "./definition";
export async function render(url: string, structured = false) {
    const factory = createSSRRender({
        definition: definition("en", "first", { pageType: "probe" }, structured),
        render: (app) => {
            const result = renderSvelte(App, { props: { app } });
            return { html: result.body, head: result.head, css: "" };
        },
    });
    try {
        const result = await factory(url);
        return { ...result, serialized: serializeServerData(result.serverData) };
    } finally {
        await factory.dispose();
    }
}
