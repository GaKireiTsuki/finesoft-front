import { createSSRRender, serializeServerData } from "@finesoft/front";
import { bootstrap } from "./bootstrap";
import { getErrorPage } from "./lib/controllers/error";

export const render = createSSRRender({
    bootstrap,
    getErrorPage,
    renderApp(page, _locale) {
        // Vue SSR requires async renderToString — in production use vue/server-renderer.
        // This simplified version returns the page title as head metadata.
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
