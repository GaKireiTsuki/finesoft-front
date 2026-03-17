import { startBrowserApp, type Action, type BasePage, type Framework } from "@finesoft/front";
import { createApp, reactive } from "vue";
import App from "./App.vue";
import { bootstrap } from "./bootstrap";

void startBrowserApp({
    bootstrap,
    mount(target: HTMLElement, { framework }: { framework: Framework; locale: string }) {
        const state = reactive<{ page: BasePage | null; loading: boolean }>({
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
                    state.page = p;
                    state.loading = false;
                });
            } else {
                state.page = page;
                state.loading = false;
            }
        };
    },
    callbacks: {
        onNavigate() {},
        onModal() {},
    },
});
