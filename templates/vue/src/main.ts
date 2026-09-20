import { createBrowserApp } from "@finesoft/front/browser";
import { createApp, createSSRApp } from "vue";
import { app } from "./app-definition";
import App from "./App.vue";
import "./styles.css";

const target = document.getElementById("app")!;
export async function mountApplication(
    target: HTMLElement,
    history: "browser" | "memory" = "browser",
    url?: string,
) {
    const handle = await createBrowserApp({ definition: app, target, history, url });
    const root = (handle.shouldHydrate ? createSSRApp : createApp)(App, { app: handle });
    root.mount(target);
    const originalDispose = handle.dispose.bind(handle);
    let disposal: Promise<void> | undefined;
    Object.assign(handle, {
        dispose: () => (disposal ??= originalDispose().finally(() => root.unmount())),
    });
    await handle.ready;
    return handle;
}

export const started = mountApplication(target);

if (import.meta.hot) {
    import.meta.hot.dispose(async () => {
        await (await started).dispose();
    });
}
