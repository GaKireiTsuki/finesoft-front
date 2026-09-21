import { createBrowserApp } from "@finesoft/front";
import { createRoot, hydrateRoot } from "react-dom/client";
import { app } from "./app-definition";
import App from "./App";
const target = document.getElementById("app")!;
export const started = createBrowserApp({ definition: app, target });
const handle = await started;
const root = handle.shouldHydrate ? hydrateRoot(target, <App app={handle} />) : createRoot(target);
if (!handle.shouldHydrate) root.render(<App app={handle} />);
if (import.meta.hot)
    import.meta.hot.dispose(async () => {
        try {
            await handle.dispose();
        } finally {
            root.unmount();
        }
    });
