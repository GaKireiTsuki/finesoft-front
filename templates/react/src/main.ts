import { createBrowserApp } from "@finesoft/front/browser";
import { createRoot, hydrateRoot } from "react-dom/client";
import { createElement } from "react";
import { app } from "./app-definition";
import App from "./App";
import "./styles.css";

const target = document.getElementById("app")!;
export async function mountApplication(
    target: HTMLElement,
    history: "browser" | "memory" = "browser",
    url?: string,
) {
    const handle = await createBrowserApp({ definition: app, target, history, url });
    const root = handle.hydrate
        ? hydrateRoot(target, createElement(App, { app: handle }))
        : createRoot(target);
    if (!handle.hydrate) root.render(createElement(App, { app: handle }));
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
