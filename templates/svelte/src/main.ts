import { startBrowserApp, type BasePage, type Framework } from "@finesoft/front";
import { hydrate } from "svelte";
import App from "./App.svelte";
import { bootstrap } from "./bootstrap";
import type { AppPage } from "./lib/models/product";

void startBrowserApp({
    bootstrap,
    mount(target: HTMLElement, { framework }: { framework: Framework }) {
        // Svelte 5 中必须用 hydrate() 激活 SSR 输出，new Component() 已被移除
        const app = hydrate(App, { target, props: { framework } });

        return (props: { page: Promise<BasePage> | BasePage; isFirstPage?: boolean }) => {
            (app as { updatePage: (p: Promise<AppPage> | AppPage) => void }).updatePage(
                props.page as Promise<AppPage> | AppPage,
            );
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
