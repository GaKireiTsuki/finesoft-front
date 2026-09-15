import { createReactSSRRender, serializeServerData } from "@finesoft/front/renderers/react/server";
import Probe from "./ReactProbe.tsx";
import { definition } from "./definition";
export async function render(url: string, mode: "root" | "entries", structured = false) {
    const factory = createReactSSRRender({
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
