import { int } from "@finesoft/core";
import { definePage, defineWebApp, type WebAppView } from "@finesoft/web";
import { createSSRRender } from "../src/create-render";

const item = definePage({
    id: "item",
    routes: [{ path: "/items/:id", params: { id: int() } }],
    handler: (params) => ({ id: String(params.id), pageType: "item", title: params.id.toFixed() }),
});
const definition = defineWebApp({
    id: "ssr-types",
    pages: [item],
    getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
});
createSSRRender({
    definition,
    render(app) {
        // @ts-expect-error SSR view keeps numeric parameters
        void app.perform({ kind: "push", intent: "item", params: { id: "42" } });
        // @ts-expect-error SSR view keeps the page id union
        void app.perform({ kind: "push", intent: "missing", params: { id: 42 } });
        const outlet: WebAppView = app;
        return String(outlet.getSnapshot().revision);
    },
});
