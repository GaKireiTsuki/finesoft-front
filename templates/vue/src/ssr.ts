import { createSSRRender, serializeServerData } from "@finesoft/front";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import App from "./App.vue";
import { bootstrap } from "./bootstrap";
import { getErrorPage } from "./lib/controllers/error";

export const render = createSSRRender({
    bootstrap,
    getErrorPage,
    async renderApp(page) {
        const app = createSSRApp(App, { page });
        const html = await renderToString(app);
        return {
            html,
            head: `<title>${page.title}</title><meta name="description" content="${
                page.description ?? ""
            }">`,
            css: "",
        };
    },
});

export { serializeServerData };
