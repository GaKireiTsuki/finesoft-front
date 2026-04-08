import { startBrowserApp } from "@finesoft/front";
import { createVueKeepAliveMount } from "@finesoft/front/vue";
import App from "./App.vue";
import { bootstrap } from "./bootstrap";

void startBrowserApp({
    bootstrap,
    mount: createVueKeepAliveMount(App),
    callbacks: {
        onNavigate(pathname) {
            console.log("[navigate]", pathname);
        },
        onModal(page) {
            console.log("[modal]", page.title);
        },
    },
});
