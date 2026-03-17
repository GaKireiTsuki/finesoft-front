import { createSSRRender, serializeServerData } from "@finesoft/front";
import { renderToString } from "react-dom/server";
import App from "./App";
import { bootstrap } from "./bootstrap";

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
    renderApp(page) {
        return {
            html: renderToString(<App page={page} />),
            head: `<title>${page.title}</title>`,
            css: "",
        };
    },
});

export { serializeServerData };
