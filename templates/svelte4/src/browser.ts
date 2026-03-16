import { startBrowserApp } from "@finesoft/front";
import App from "./App.svelte";
import { bootstrap } from "./lib/bootstrap";

void startBrowserApp({
    bootstrap,
    defaultLocale: "en",
    mount: (target, { framework, locale }) => {
        const app = new App({
            target,
            hydrate: true,
            props: {
                locale,
                framework,
            },
        });

        return (props) => {
            app.$set(props as any);
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
