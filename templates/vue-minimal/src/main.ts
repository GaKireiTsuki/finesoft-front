import { startBrowserApp, type BasePage } from "@finesoft/front";
import { createApp, type App as VueApp } from "vue";
import App from "./App.vue";
import { bootstrap } from "./bootstrap";

void startBrowserApp({
    bootstrap,
    mount(target, { locale: _locale }) {
        const app: VueApp = createApp(App);
        const vm = app.mount(target);

        return ({ page }) => {
            const resolve = async () => {
                const resolved: BasePage = page instanceof Promise ? await page : page;
                (vm as unknown as { update: (page: BasePage) => void }).update(resolved);
            };
            void resolve();
        };
    },
    callbacks: {
        onNavigate() {},
        onModal() {},
    },
});
