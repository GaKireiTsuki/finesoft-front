import { startBrowserApp } from "@finesoft/front/browser";
import { createVueRenderer } from "@finesoft/front/renderers/vue/browser";
import { app } from "./app-definition";
import { appId } from "./config";
import { createInstance } from "./instance";
import { views } from "./views";
import "./styles.css";

export function mountApplication(
    target: HTMLElement,
    persistenceKey = appId,
    history: "browser" | "memory" = "browser",
    url?: string,
) {
    const { nameStore, profileProvider } = createInstance();
    return startBrowserApp({
        app,
        target,
        history,
        url,
        persistenceKey,
        domRestore: true,
        session: { providers: [profileProvider] },
        renderer: createVueRenderer({ ...views, props: () => ({ nameStore }) }),
    });
}

export const started = mountApplication(document.getElementById("app")!);

if (import.meta.hot) {
    import.meta.hot.dispose(async () => {
        await (await started).dispose();
    });
}
