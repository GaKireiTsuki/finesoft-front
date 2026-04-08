import { startBrowserApp } from "@finesoft/front";
import { createReactKeepAliveMount } from "@finesoft/front/react";
import App from "./App";
import { bootstrap } from "./bootstrap";

void startBrowserApp({
    bootstrap,
    mountId: "app",
    mount: createReactKeepAliveMount(App),
    callbacks: {
        onNavigate(pathname) {
            console.log("[navigate]", pathname);
        },
        onModal(page) {
            console.log("[modal]", page.title);
        },
    },
});
