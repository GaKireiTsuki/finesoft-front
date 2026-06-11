import { createSSRNavigationRender, serializeServerData } from "@finesoft/front";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import App from "./App.vue";
import { bootstrap, navigation } from "./bootstrap";

/**
 * 結構化導航的 SSR：從 URL 解析初始樹 → 預取所有可見目標 → 注入 HTML。
 * 序列化的導航樹 + 各目標 prefetch 結果經既有 `PrefetchedIntents` 通道注入 HTML，
 * 瀏覽器 hydrate 後由 main.ts 接管交互式導航。
 *
 * Islands 架構說明：
 * - SSR 只渲 chrome（header + tab bar + 空的 `<main data-fs-outlet>`）。
 * - 頁面 **內容** 為 client-side islands（首屏 island 複用 SSR prefetch 結果，
 *   直接讀取 PrefetchedIntents，不重複發請求）。
 * - 服務端渲染 island 內容（含水合）列為後續跟進，本阶段不实现。
 */
export const render = createSSRNavigationRender({
    bootstrap,
    getErrorPage(status, message) {
        return {
            id: "error",
            pageType: "error",
            title: `Error ${status}`,
            description: message,
        };
    },
    async renderApp(page, _framework, _snapshot) {
        // App.vue 渲 chrome shell（header + outlet）；island 内容在客户端挂载。
        // page.title 用于 <title> 注入；App 本身不消费 page prop（chrome 无页面内容）。
        const app = createSSRApp(App);
        const html = await renderToString(app);
        return {
            html,
            head: `<title>${page.title}</title>`,
            css: "",
        };
    },
    navigation: navigation.toSSRDefinition(),
});

export { serializeServerData };
