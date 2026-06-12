import {
    createSSRNavigationRender,
    renderIslandsHtml,
    serializeServerData,
    type BasePage,
    type ResolvedEntry,
} from "@finesoft/front";
import type { ComponentType } from "react";
import { renderToString } from "react-dom/server";
import App from "./App";
import { bootstrap, navigation } from "./bootstrap";
import DetailView from "./views/DetailView";
import HomeView from "./views/HomeView";
import NotesView from "./views/NotesView";

const VIEWS: Record<string, ComponentType<{ page: BasePage }>> = {
    home: HomeView,
    detail: DetailView,
    notes: NotesView,
};

/**
 * islands 架构 SSR（方案 C）：
 * - chrome（App，header + tabbar）渲进 `<div data-fs-chrome>`。
 * - 可见 island 内容由 `renderIslandsHtml` 渲进 sibling `<main data-fs-outlet>`，客户端按 key 收养水合。
 *
 * chrome 水合 props parity：客户端 mount 时 navigation.getSnapshot() 即此 URL 推导 snapshot
 * （tree 一致）→ chrome 水合无失配，且 nav bar 首屏即被 SSR 渲出。name 仍默认 ""（会话恢复在
 * mount 后、水合后才生效）。nav/controller/nameStore 仅事件与订阅用，不影响 SSR DOM，可省。
 */
export const render = createSSRNavigationRender({
    bootstrap,
    getErrorPage(status, message) {
        return { id: "error", pageType: "error", title: `Error ${status}`, description: message };
    },
    async renderApp(page, _framework, snapshot) {
        const chromeHtml = renderToString(<App initialSnapshot={snapshot} />);
        const islandsHtml = await renderIslandsHtml(snapshot, (entry: ResolvedEntry) => {
            const View = VIEWS[entry.intent] ?? HomeView;
            return renderToString(<View page={entry.page} />);
        });
        return {
            html: `<div data-fs-chrome>${chromeHtml}</div><main data-fs-outlet>${islandsHtml}</main>`,
            head: `<title>${page.title}</title>`,
            css: "",
        };
    },
    navigation: navigation.toSSRDefinition(),
});

export { serializeServerData };
