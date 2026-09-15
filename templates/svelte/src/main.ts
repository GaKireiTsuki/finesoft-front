import { startBrowserApp } from "@finesoft/front/browser";
import { createSvelteRenderer } from "@finesoft/front/renderers/svelte/browser";
import { app } from "./app-definition";
import { views } from "./views";
export const started = startBrowserApp({
    app,
    renderer: createSvelteRenderer(views),
    target: document.getElementById("app")!,
});
if (import.meta.hot)
    import.meta.hot.dispose(async () => {
        await (await started).dispose();
    });
