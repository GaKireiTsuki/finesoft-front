import { render as renderSvelte } from "svelte/server";
import { createSSRRender } from "@finesoft/front";
export { serializeServerData } from "@finesoft/front";
import App from "./SvelteApp.svelte";
import { definition } from "./definition";
export const render = createSSRRender({
    definition: definition(),
    render: (app) => {
        const result = renderSvelte(App, { props: { app } });
        return { html: result.body, head: result.head, css: "" };
    },
});
