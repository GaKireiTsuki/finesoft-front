import {
    createSSRNavigationRender,
    renderIslandsHtml,
    serializeServerData,
    type ResolvedEntry,
} from "@finesoft/front";
import { createSSRApp, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import App from "./App.vue";
import HomeView from "./views/HomeView.vue";
import DetailView from "./views/DetailView.vue";
import NotesView from "./views/NotesView.vue";
import { bootstrap, navigation } from "./bootstrap";

const VIEWS: Record<string, Component> = { home: HomeView, detail: DetailView, notes: NotesView };

/**
 * islands 架构 SSR（方案 C）：
 * - chrome（App.vue，header + tabbar）渲进 `<div data-fs-chrome>`。
 * - 可见 island 内容由 `renderIslandsHtml` 渲进 sibling `<main data-fs-outlet>`，客户端按 key 收养水合。
 *
 * chrome 水合 props parity：SSR 必须用与客户端 hydrate 时**相同**的初始 state 渲 App，否则
 * App.vue 的 `v-if="state"`（name label 等）server/client 不一致 → hydration mismatch。
 * 客户端 hydrate 时 state = { snapshot: null, name: "" }（onNavigationReady / session 恢复都在
 * 水合**之后**才填）。controller 仅用于事件处理器（`controller?.`），不影响渲染 DOM，SSR 可省。
 */
export const render = createSSRNavigationRender({
    bootstrap,
    getErrorPage(status, message) {
        return { id: "error", pageType: "error", title: `Error ${status}`, description: message };
    },
    async renderApp(page, _framework, snapshot) {
        const chromeHtml = await renderToString(
            createSSRApp(App, { state: { snapshot: null, name: "" } }),
        );
        const islandsHtml = await renderIslandsHtml(snapshot, (entry: ResolvedEntry) =>
            renderToString(createSSRApp(VIEWS[entry.intent] ?? HomeView, { page: entry.page })),
        );
        return {
            html: `<div data-fs-chrome>${chromeHtml}</div><main data-fs-outlet>${islandsHtml}</main>`,
            head: `<title>${page.title}</title>`,
            css: "",
        };
    },
    navigation: navigation.toSSRDefinition(),
});

export { serializeServerData };
