import { createSSRRender, serializeServerData, type BasePage } from "@finesoft/front";
import { render as svelteRender } from "svelte/server";
import App from "./App.svelte";
import { bootstrap } from "./bootstrap";

export const render = createSSRRender({
    bootstrap,
    getErrorPage(status, message): BasePage {
        return {
            id: "error",
            pageType: "error",
            title: `Error ${status}`,
            description: message,
        };
    },
    renderApp(page, _locale) {
        const { html, head } = svelteRender(App, { props: { page } });
        return {
            html,
            head: `<title>${page.title}</title>${head}`,
            css: "",
        };
    },
});

export { serializeServerData };
