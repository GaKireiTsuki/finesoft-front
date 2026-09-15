import { startBrowserApp } from "@finesoft/front/browser";
import { createVueRenderer } from "@finesoft/front/renderers/vue/browser";
import { app } from "./app-definition";
import { views } from "./views";
import { createInstance } from "./instance";
export function mountApplication(
    target: HTMLElement,
    persistenceKey = "vue-minimal",
    history: "browser" | "memory" = "browser",
) {
    const { state, profileProvider } = createInstance();
    return startBrowserApp({
        app,
        target,
        history,
        persistenceKey,
        domRestore: true,
        session: { providers: [profileProvider] },
        renderer: createVueRenderer({
            ...views,
            props: ({ initialSnapshot }) => ({
                state: { ...state, snapshot: initialSnapshot },
                profile: state,
            }),
        }),
    });
}
export const started = mountApplication(document.getElementById("app")!);
if (import.meta.hot)
    import.meta.hot.dispose(async () => {
        await (await started).dispose();
    });
