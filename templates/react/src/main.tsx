import { startBrowserApp } from "@finesoft/front/browser";
import { createReactRenderer } from "@finesoft/front/renderers/react/browser";
import { app } from "./app-definition";
import { views } from "./views";
export const started = startBrowserApp({
    app,
    renderer: createReactRenderer(views),
    target: document.getElementById("app")!,
});
if (import.meta.hot)
    import.meta.hot.dispose(async () => {
        await (await started).dispose();
    });
