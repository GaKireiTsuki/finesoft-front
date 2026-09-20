import { createBrowserApp } from "@finesoft/front/browser";
import { createRoot, hydrateRoot } from "react-dom/client";
import { createElement } from "react";
import { app } from "./app-definition";
import { appId } from "./config";
import App from "./App";
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
    const root = handle.shouldHydrate
        ? hydrateRoot(target, createElement(App, { app: handle }))
        : createRoot(target);
    if (!handle.shouldHydrate) root.render(createElement(App, { app: handle }));
    const originalDispose = handle.dispose.bind(handle);
    let disposal: Promise<void> | undefined;
    Object.assign(handle, {
        dispose: () => (disposal ??= originalDispose().finally(() => root.unmount())),
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
