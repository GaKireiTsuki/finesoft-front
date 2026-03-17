import { startBrowserApp, type Action, type BasePage, type Framework } from "@finesoft/front";
import { createApp, reactive } from "vue";
import App from "./App.vue";
import { bootstrap } from "./bootstrap";
import type { AppPage } from "./lib/models/product";

void startBrowserApp({
    bootstrap,
    mount(target: HTMLElement, { framework }: { framework: Framework; locale: string }) {
        const state = reactive<{ page: AppPage | null; loading: boolean }>({
            page: null,
            loading: false,
        });
        const handleAction = (action: Action) => {
            void framework.perform(action);
        };
        createApp(App, { state, onAction: handleAction }).mount(target);

        return ({
            page,
            isFirstPage,
        }: {
            page: Promise<BasePage> | BasePage;
            isFirstPage?: boolean;
        }) => {
            if (page instanceof Promise) {
                if (!isFirstPage) state.loading = true;
                void page.then((p) => {
                    state.page = p as AppPage;
                    state.loading = false;
                });
            } else {
                state.page = page as AppPage;
                state.loading = false;
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
