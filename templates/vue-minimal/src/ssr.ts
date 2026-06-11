import { createSSRNavigationRender, serializeServerData } from "@finesoft/front";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import App from "./App.vue";
import { bootstrap, navigation } from "./bootstrap";

/**
 * 结构化导航的 SSR：从 URL 解析初始树 → 预取所有可见目标 → 渲染主目标（激活叶子）页面。
 * 序列化的导航树 + 各目标 prefetch 结果经既有 `PrefetchedIntents` 通道注入 HTML，
 * 浏览器 hydrate 后由 main.ts 接管交互式导航。
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
        const app = createSSRApp(App, { page });
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
