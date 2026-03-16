import { createSSRRender, serializeServerData } from "@finesoft/front";
import { renderToString } from "react-dom/server";
import App from "./App";
import { bootstrap } from "./bootstrap";
import { getErrorPage } from "./lib/controllers/error";

export const render = createSSRRender({
    bootstrap,
    getErrorPage,
    renderApp(page, _locale) {
        return {
            html: renderToString(<App initialPage={page} />),
            head: `<title>${page.title}</title><meta name="description" content="${
                page.description ?? ""
            }">`,
            css: "",
        };
    },
});

export { serializeServerData };
