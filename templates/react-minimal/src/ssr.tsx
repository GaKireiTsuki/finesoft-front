import { createSSRRender, serializeServerData, type BasePage } from "@finesoft/front";
import { renderToString } from "react-dom/server";
import App from "./App";
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
        return {
            html: renderToString(<App initialPage={page} />),
            head: `<title>${page.title}</title>`,
            css: "",
        };
    },
});

export { serializeServerData };
