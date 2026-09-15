import { createReactSSRRender } from "@finesoft/front/renderers/react/server";
export { serializeServerData } from "@finesoft/front/renderers/react/server";
import Probe from "./ReactProbe.tsx";
import { definition } from "./definition";
export const render = createReactSSRRender({
    app: definition(),
    renderer: { mode: "root", views: { probe: Probe } },
});
