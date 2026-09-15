import { createVueSSRRender, serializeServerData } from "@finesoft/front/renderers/vue/server";
import Probe from "./VueProbe.vue";
import { definition } from "./definition";
export async function render(url: string, mode: "root" | "entries", structured = false) {
    const factory = createVueSSRRender({
        app: definition("en", "first", { pageType: "probe" }, structured),
        renderer: { mode, views: { probe: Probe, other: Probe } },
    });
    try {
        const result = await factory(url);
        return { ...result, serialized: serializeServerData(result.serverData) };
    } finally {
        await factory.dispose();
    }
}
