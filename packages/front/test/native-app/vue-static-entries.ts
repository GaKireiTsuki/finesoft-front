import { createVueSSRRender } from "@finesoft/front/renderers/vue/server";
export { serializeServerData } from "@finesoft/front/renderers/vue/server";
import Probe from "./VueProbe.vue";
import { definition } from "./definition";
export const render = createVueSSRRender({
    app: definition(),
    renderer: { mode: "entries", views: { probe: Probe } },
});
