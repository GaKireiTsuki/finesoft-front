import { createSSRRender, serializeServerData, type BasePage } from "@finesoft/front";
import { createSSRApp } from "vue";
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
    renderApp(page, _locale) {
        const app = createSSRApp(App);
        const vm = app._instance?.exposed ?? {};
        vm.update?.(page);

        return {
            html: "", // Vue SSR requires async renderToString — handled below
            head: `<title>${page.title}</title>`,
            css: "",
        };
    },
});

export { serializeServerData };
