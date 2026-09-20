import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { createSSRRender } from "@finesoft/front/ssr";
export { serializeServerData } from "@finesoft/front/ssr";
import App from "./VueApp.vue";
import { definition } from "./definition";
export const render = createSSRRender({
    definition: definition(),
    render: (app) => renderToString(createSSRApp(App, { app })),
});
