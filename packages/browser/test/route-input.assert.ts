import { int } from "@finesoft/core";
import { definePage, defineWebApp, type WebAppView } from "@finesoft/web";
import { createBrowserApp } from "../src/start-app";

const item = definePage({
    id: "item",
    routes: [{ path: "/items/:id", params: { id: int() } }],
    handler: (params) => ({ id: String(params.id), pageType: "item", title: params.id.toFixed() }),
});
const definition = defineWebApp({
    id: "browser-types",
    pages: [item],
    getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
});
declare const target: HTMLElement;
const app = await createBrowserApp({
    definition,
    target,
    onModal(_page, { app }) {
        // @ts-expect-error modal view keeps the application contract
        void app.perform({ kind: "push", intent: "item", params: { id: "42" } });
    },
});
void app.perform({ kind: "push", intent: "item", params: { id: 42 } });
// @ts-expect-error browser handle keeps numeric parameters
void app.perform({ kind: "push", intent: "item", params: { id: "42" } });
// @ts-expect-error browser handle keeps the page id union
void app.perform({ kind: "push", intent: "missing", params: { id: 42 } });
const outlet: WebAppView = app;
void outlet;
