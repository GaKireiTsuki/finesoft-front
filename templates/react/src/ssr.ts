import { createReactSSRRender } from "@finesoft/front/renderers/react/server";
import { app } from "./app-definition";
import { views } from "./views";

export const render = createReactSSRRender({ app, renderer: views });
export { serializeServerData } from "@finesoft/front/ssr";
