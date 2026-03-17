import { createSSRRender, serializeServerData } from "@finesoft/front";
import { bootstrap } from "./bootstrap";
import { renderApp } from "./lib/render";

export const render = createSSRRender({
    bootstrap,
    getErrorPage(status, message) {
        return {
            id: "error",
            pageType: "error",
            title: `Error ${status}`,
            description: message,
        };
    },
    renderApp,
});

export { serializeServerData };
