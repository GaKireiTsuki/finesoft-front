import { startBrowserApp } from "@finesoft/front/browser";
import { createVueRenderer } from "@finesoft/front/renderers/vue/browser";
import { app } from "./app-definition";
import { views } from "./views";
export const started = startBrowserApp({
    app,
    renderer: createVueRenderer(views),
    target: document.getElementById("app")!,
});
if (import.meta.hot)
    import.meta.hot.dispose(async () => {
        await (await started).dispose();
    });
