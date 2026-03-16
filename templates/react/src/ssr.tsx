import { createSSRRender, serializeServerData } from "@finesoft/front";
import { bootstrap } from "./bootstrap";
import { getErrorPage } from "./lib/controllers/error";

export const render = createSSRRender({
    bootstrap,
    getErrorPage,
    renderApp(page, _locale) {
        return {
            html: `<div data-page="${page.pageType}">${page.title}</div>`,
            head: `<title>${page.title}</title><meta name="description" content="${
                page.description ?? ""
            }">`,
            css: "",
        };
    },
});

export { serializeServerData };
