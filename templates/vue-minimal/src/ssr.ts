import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { createSSRRender } from "@finesoft/front";
import { app } from "./app-definition";
import App from "./App.vue";

export const render = createSSRRender({
    definition: app,
    render: (app) => renderToString(createSSRApp(App, { app })),
});
export { serializeServerData } from "@finesoft/front";
