import { createSSRRender, serializeServerData } from "@finesoft/front";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import App from "./App.vue";
import { bootstrap } from "./lib/bootstrap";
import type { ErrorPage, Page } from "./lib/models/page";

export { serializeServerData };

function getErrorPage(status: number, message: string): ErrorPage {
    return {
        id: `page-error-${status}`,
        pageType: "error",
        title: "Error",
        errorMessage: message,
        statusCode: status,
    };
}

export const render = createSSRRender({
    bootstrap,
    getErrorPage,
    // renderApp is typed sync; cast to satisfy the interface.
    // Vue's renderToString is async, which works at runtime because
    // the outer ssrRender path is already async.
    renderApp(page, locale) {
        const app = createSSRApp(App, {
            page: page as Page,
            isFirstPage: true,
            locale,
        });

        return renderToString(app).then((html) => ({
            html,
            head: "",
            css: "",
        })) as any;
    },
});
