import { startBrowserApp, type Action, type BasePage, type Framework } from "@finesoft/front";
import { createRoot } from "react-dom/client";
import App from "./App";
import { bootstrap } from "./bootstrap";
import type { AppPage } from "./lib/models/product";

void startBrowserApp({
    bootstrap,
    mountId: "app",
    mount: (target: HTMLElement, { framework }: { framework: Framework; locale: string }) => {
        let root: ReturnType<typeof createRoot> | null = null;
        let currentPage: AppPage | null = null;

        function render(page: AppPage | null, loading: boolean) {
            const handleAction = (action: Action) => {
                void framework.perform(action);
            };
            if (!root) root = createRoot(target);
            root.render(<App page={page} loading={loading} onAction={handleAction} />);
        }

        return ({
            page,
            isFirstPage,
        }: {
            page: Promise<BasePage> | BasePage;
            isFirstPage?: boolean;
        }) => {
            if (page instanceof Promise) {
                if (!isFirstPage) render(currentPage, true);
                void page.then((p) => {
                    currentPage = p as AppPage;
                    render(currentPage, false);
                });
            } else {
                currentPage = page as AppPage;
                render(currentPage, false);
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
