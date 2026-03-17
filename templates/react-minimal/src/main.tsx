import { startBrowserApp, type Action, type BasePage, type Framework } from "@finesoft/front";
import { createRoot } from "react-dom/client";
import App from "./App";
import { bootstrap } from "./bootstrap";

void startBrowserApp({
    bootstrap,
    mountId: "app",
    mount: (target: HTMLElement, { framework }: { framework: Framework; locale: string }) => {
        let root: ReturnType<typeof createRoot> | null = null;
        let currentPage: BasePage | null = null;

        function render(page: BasePage | null, loading: boolean) {
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
                    currentPage = p;
                    render(currentPage, false);
                });
            } else {
                currentPage = page;
                render(currentPage, false);
            }
        };
    },
    callbacks: {
        onNavigate() {},
        onModal() {},
    },
});
