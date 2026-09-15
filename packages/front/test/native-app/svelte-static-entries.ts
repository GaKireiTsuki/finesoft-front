import { createSvelteSSRRender } from "@finesoft/front/renderers/svelte/server";
export { serializeServerData } from "@finesoft/front/renderers/svelte/server";
import Probe from "./SvelteProbe.svelte";
import { definition } from "./definition";
export const render = createSvelteSSRRender({
    app: definition(),
    renderer: { mode: "entries", views: { probe: Probe } },
});
