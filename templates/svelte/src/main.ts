import { startBrowserApp } from "@finesoft/front";
import { createSvelteKeepAliveMount } from "@finesoft/front/svelte";
import App from "./App.svelte";
import { bootstrap } from "./bootstrap";

void startBrowserApp({
    bootstrap,
    mount: createSvelteKeepAliveMount(App),
    callbacks: {
        onNavigate(pathname) {
            console.log("[navigate]", pathname);
        },
        onModal(page) {
            console.log("[modal]", page.title);
        },
    },
});
