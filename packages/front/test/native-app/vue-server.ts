import { createVueSSRRender, serializeServerData } from "@finesoft/front/renderers/vue/server";
import Chrome from "./VueChrome.vue";
import Probe from "./VueProbe.vue";
import { definition } from "./definition";
export async function render(
    url: string,
    mode: "root" | "entries",
    structured = false,
    chrome = false,
) {
    const factory = createVueSSRRender({
        app: definition("en", "first", { pageType: "probe" }, structured),
        renderer: {
            mode,
            chrome: chrome ? Chrome : undefined,
            views: { probe: Probe, other: Probe },
        },
    });
    try {
        const result = await factory(url);
        return { ...result, serialized: serializeServerData(result.serverData) };
    } finally {
        await factory.dispose();
    }
}
