import { startBrowserApp } from "@finesoft/front/browser";
import { createReactRenderer } from "@finesoft/front/renderers/react/browser";
import { app } from "./app-definition";
import { views } from "./views";
import { createInstance } from "./instance";
export function mountApplication(
    target: HTMLElement,
    persistenceKey = "react-minimal",
    history: "browser" | "memory" = "browser",
) {
    const { nameStore, profileProvider } = createInstance();
    return startBrowserApp({
        app,
        target,
        history,
        persistenceKey,
        domRestore: true,
        session: { providers: [profileProvider] },
        renderer: createReactRenderer({
            ...views,
            props: ({ controller }) => ({ nameStore, nav: controller?.navigation }),
        }),
    });
}
export const started = mountApplication(document.getElementById("app")!);
if (import.meta.hot)
    import.meta.hot.dispose(async () => {
        await (await started).dispose();
    });
