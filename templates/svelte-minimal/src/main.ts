import { startBrowserApp, type BasePage } from "@finesoft/front";
import { hydrate } from "svelte";
import App from "./App.svelte";
import { bootstrap } from "./bootstrap";

void startBrowserApp({
    bootstrap,
    mount(target) {
        const app = hydrate(App, { target });

        return ({ page }) => {
            const resolve = async () => {
                const resolved: BasePage = page instanceof Promise ? await page : page;
                (app as { update: (page: BasePage) => void }).update(resolved);
            };
            void resolve();
        };
    },
    callbacks: {
        onNavigate() {},
        onModal() {},
    },
});
