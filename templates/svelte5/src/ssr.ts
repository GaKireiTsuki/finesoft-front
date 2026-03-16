import { createSSRRender, serializeServerData } from "@finesoft/front";
import { render as svelteRender } from "svelte/server";
import App from "./App.svelte";
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
    renderApp(page, locale) {
        const result = svelteRender(App, {
            props: {
                page: page as Page,
                isFirstPage: true,
                locale,
            },
        });

        return {
            html: result.body ?? "",
            head: result.head ?? "",
            css: "",
        };
    },
});
