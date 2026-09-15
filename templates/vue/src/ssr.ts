import { createVueSSRRender } from "@finesoft/front/renderers/vue/server";
import { app } from "./app-definition";
import { views } from "./views";
export const render = createVueSSRRender({ app, renderer: views });
export { serializeServerData } from "@finesoft/front/renderers/vue/server";
