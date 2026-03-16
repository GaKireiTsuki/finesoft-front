import type { BasePage } from "@finesoft/front";
import { startBrowserApp } from "@finesoft/front";
import { createSSRApp as createVueApp } from "vue";
import App from "./App.vue";
import { bootstrap } from "./lib/bootstrap";

void startBrowserApp({
    bootstrap,
    defaultLocale: "en",
    mount: (target, { framework, locale }) => {
        const vueApp = createVueApp(App, {
            page: {} as BasePage,
            isFirstPage: true,
            locale,
            framework,
        });

        const vm = vueApp.mount(target);

        return (props) => {
            Object.assign(vm.$props, props);
        };
    },
    callbacks: {
        onNavigate(pathname) {
            console.log("navigate:", pathname);
        },
        onModal(page) {
            console.log("modal:", page);
        },
    },
});
