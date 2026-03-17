import { startBrowserApp, type Action, type BasePage, type Framework } from "@finesoft/front";
import { hydrate } from "svelte";
import App from "./App.svelte";
import { bootstrap } from "./bootstrap";

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
                    setPage: (p: BasePage | null, loading: boolean) => void;
                }
            ).setPage;
            if (page instanceof Promise) {
                if (!isFirstPage) setPage(null, true);
                void page.then((p) => {
                    setPage(p, false);
                });
            } else {
                setPage(page, false);
            }
        };
    },
    callbacks: {
        onNavigate() {},
        onModal() {},
    },
});
