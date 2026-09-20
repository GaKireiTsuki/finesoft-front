import { createBrowserApp } from "@finesoft/front/browser";
import { hydrate, mount, unmount } from "svelte";
import { app } from "./app-definition";
import { appId } from "./config";
import App from "./App.svelte";
import "./styles.css";

export async function mountApplication(
    target: HTMLElement,
    persistenceKey = appId,
    history: "browser" | "memory" = "browser",
    url?: string,
) {
    const handle = await createBrowserApp({
        definition: app,
        target,
        history,
        url,
        persistenceKey,
        domRestore: true,
        session: {},
    });
    if (!handle.hydrate) target.replaceChildren();
    const root = (handle.hydrate ? hydrate : mount)(App, { target, props: { app: handle } });
    const originalDispose = handle.dispose.bind(handle);
    let disposal: Promise<void> | undefined;
    Object.assign(handle, {
        dispose: () => (disposal ??= originalDispose().finally(() => unmount(root))),
    });
    await handle.ready;
    return handle;
}

export const started = mountApplication(document.getElementById("app")!);

if (import.meta.hot) {
    import.meta.hot.dispose(async () => {
        await (await started).dispose();
    });
}
