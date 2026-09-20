import { render as renderSvelte } from "svelte/server";
import { createSSRRender } from "@finesoft/front/ssr";
export { serializeServerData } from "@finesoft/front/ssr";
import App from "./SvelteApp.svelte";
import { definition } from "./definition";
export const render = createSSRRender({
    definition: definition(),
    render: (app) => {
        const result = renderSvelte(App, { props: { app } });
        return { html: result.body, head: result.head, css: "" };
    },
});
