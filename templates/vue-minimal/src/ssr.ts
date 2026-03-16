import { createSSRRender, serializeServerData, type BasePage } from "@finesoft/front";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import App from "./App.vue";
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
    async renderApp(page, _locale) {
        const app = createSSRApp(App, { page });
        const html = await renderToString(app);
        return {
            html,
            head: `<title>${page.title}</title>`,
            css: "",
        };
    },
});

export { serializeServerData };
