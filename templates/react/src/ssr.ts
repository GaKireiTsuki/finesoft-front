import { createSSRRender, serializeServerData } from "@finesoft/front";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import App from "./App";
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
        const html = renderToString(
            createElement(App, {
                page: page as Page,
                isFirstPage: true,
                locale,
            }),
        );

        return {
            html,
            head: "",
            css: "",
        };
    },
});
