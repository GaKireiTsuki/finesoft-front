import { render as renderSvelte } from "svelte/server";
import { createSSRRender } from "@finesoft/front";
import { app } from "./app-definition";
import App from "./App.svelte";

export const render = createSSRRender({
    definition: app,
    render: (app) => {
        const result = renderSvelte(App, { props: { app } });
        return { html: result.body, head: result.head, css: "" };
    },
});
export { serializeServerData } from "@finesoft/front";
