import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { createSSRRender } from "@finesoft/front";
export { serializeServerData } from "@finesoft/front";
import App from "./VueApp.vue";
import { definition } from "./definition";
export const render = createSSRRender({
    definition: definition(),
    render: (app) => renderToString(createSSRApp(App, { app })),
});
