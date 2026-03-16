import { createSSRRender, serializeServerData } from "@finesoft/front";
import { render as svelteRender } from "svelte/server";
import App from "./App.svelte";
import { bootstrap } from "./bootstrap";
import { getErrorPage } from "./lib/controllers/error";

export const render = createSSRRender({
    bootstrap,
    getErrorPage,
    renderApp(page, _locale) {
        const { html, head } = svelteRender(App, { props: { page } });
        return {
            html,
            head: `<title>${page.title}</title><meta name="description" content="${
                page.description ?? ""
            }">${head}`,
            css: "",
        };
    },
});

export { serializeServerData };
