import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { createSSRRender, serializeServerData } from "@finesoft/front/ssr";
import App from "./VueApp.vue";
import { definition } from "./definition";
export async function render(url: string, structured = false) {
    const factory = createSSRRender({
        definition: definition("en", "first", { pageType: "probe" }, structured),
        render: (app) => renderToString(createSSRApp(App, { app })),
    });
    try {
        const result = await factory(url);
        return { ...result, serialized: serializeServerData(result.serverData) };
    } finally {
        await factory.dispose();
    }
}
