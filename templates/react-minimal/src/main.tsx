import { startBrowserApp, type BasePage } from "@finesoft/front";
import { createRoot } from "react-dom/client";
import App from "./App";
import { bootstrap } from "./bootstrap";

void startBrowserApp({
    bootstrap,
    mount(target) {
        const root = createRoot(target);
        root.render(<App />);

        return ({ page }) => {
            const resolve = async () => {
                const resolved: BasePage = page instanceof Promise ? await page : page;
                const updateApp = (
                    window as unknown as {
                        __updateApp?: (page: BasePage) => void;
                    }
                ).__updateApp;
                if (updateApp) updateApp(resolved);
            };
            void resolve();
        };
    },
    callbacks: {
        onNavigate() {},
        onModal() {},
    },
});
