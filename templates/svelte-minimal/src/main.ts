import { startBrowserApp, type BasePage, type Framework } from "@finesoft/front";
import { hydrate } from "svelte";
import App from "./App.svelte";
import { bootstrap } from "./bootstrap";

void startBrowserApp({
    bootstrap,
    mount(target: HTMLElement, { framework }: { framework: Framework }) {
        // Svelte 5 中必须用 hydrate() 激活 SSR 输出，new Component() 已被移除
        const app = hydrate(App, { target, props: { framework } });

        return (props: { page: Promise<BasePage> | BasePage; isFirstPage?: boolean }) => {
            (app as { updatePage: (p: Promise<BasePage> | BasePage) => void }).updatePage(
                props.page,
            );
        };
    },
    callbacks: {
        onNavigate() {},
        onModal() {},
    },
});
