import { startBrowserApp } from "@finesoft/front";
import { hydrate } from "svelte";
import App from "./App.svelte";
import { bootstrap } from "./lib/bootstrap";

void startBrowserApp({
    bootstrap,
    defaultLocale: "en",
    mount: (target, { framework, locale }) => {
        const app = hydrate(App, {
            target,
            props: {
                locale,
                framework,
            },
        });

        return (props) => {
            Object.assign(app, props);
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
