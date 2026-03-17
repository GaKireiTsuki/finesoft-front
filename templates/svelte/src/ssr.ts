import { createSSRRender, serializeServerData } from "@finesoft/front";
import { bootstrap } from "./bootstrap";
import { getErrorPage } from "./lib/controllers/error";
import { renderApp } from "./lib/render";

export const render = createSSRRender({
    bootstrap,
    getErrorPage,
    renderApp,
});

export { serializeServerData };
