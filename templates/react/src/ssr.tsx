import { createSSRRender, serializeServerData } from "@finesoft/front";
import { renderToString } from "react-dom/server";
import App from "./App";
import { bootstrap } from "./bootstrap";
import { getErrorPage } from "./lib/controllers/error";
import type { AppPage } from "./lib/models/product";

export { serializeServerData };

export const render = createSSRRender({
    bootstrap,
    getErrorPage,
    renderApp(page, _locale) {
        const html = renderToString(<App page={page as AppPage} />);
        return {
            html,
            head: `<title>${page.title}</title><meta name="description" content="${
                page.description ?? ""
            }">`,
            css: "",
        };
    },
});
