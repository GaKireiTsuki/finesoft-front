import { createSvelteSSRRender } from "@finesoft/front/renderers/svelte/server";
import { app } from "./app-definition";
import { views } from "./views";

export const render = createSvelteSSRRender({ app, renderer: views });
export { serializeServerData } from "@finesoft/front/ssr";
