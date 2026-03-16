import { startBrowserApp, type BasePage } from "@finesoft/front";
import { hydrateRoot } from "react-dom/client";
import App from "./App";
import { bootstrap } from "./bootstrap";

let isFirstMount = true;

void startBrowserApp({
    bootstrap,
    mount(target) {
        return ({ page }) => {
            const resolve = async () => {
                const resolved: BasePage = page instanceof Promise ? await page : page;

                if (isFirstMount) {
                    isFirstMount = false;
                    hydrateRoot(target, <App initialPage={resolved} />);
                } else {
                    const updateApp = (
                        window as unknown as {
                            __updateApp?: (page: BasePage) => void;
                        }
                    ).__updateApp;
                    if (updateApp) updateApp(resolved);
                }
            };
            void resolve();
        };
    },
    callbacks: {
        onNavigate(pathname) {
            console.log("[navigate]", pathname);
        },
        onModal(page) {
            console.log("[modal]", page.title);
        },
    },
});
