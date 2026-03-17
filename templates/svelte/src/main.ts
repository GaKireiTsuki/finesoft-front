import { startBrowserApp, type Action, type BasePage, type Framework } from "@finesoft/front";
import { hydrate } from "svelte";
import App from "./App.svelte";
import { bootstrap } from "./bootstrap";
import type { AppPage } from "./lib/models/product";

void startBrowserApp({
    bootstrap,
    mount(target: HTMLElement, { framework }: { framework: Framework; locale: string }) {
        const handleAction = (action: Action) => {
            void framework.perform(action);
        };
        const app = hydrate(App, { target, props: { onaction: handleAction } });

        return ({
            page,
            isFirstPage,
        }: {
            page: Promise<BasePage> | BasePage;
            isFirstPage?: boolean;
        }) => {
            const setPage = (
                app as {
                    setPage: (p: AppPage | null, loading: boolean) => void;
                }
            ).setPage;
            if (page instanceof Promise) {
                if (!isFirstPage) setPage(null, true);
                void page.then((p) => {
                    setPage(p as AppPage, false);
                });
            } else {
                setPage(page as AppPage, false);
            }
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
