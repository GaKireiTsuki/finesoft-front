import {
    createSvelteSSRRender,
    serializeServerData,
} from "@finesoft/front/renderers/svelte/server";
import Probe from "./SvelteProbe.svelte";
import { definition } from "./definition";
export async function render(url: string, mode: "root" | "entries", structured = false) {
    const factory = createSvelteSSRRender({
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
