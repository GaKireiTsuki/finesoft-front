import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { createSSRRender } from "@finesoft/front";
export { serializeServerData } from "@finesoft/front";
import App from "./ReactApp.tsx";
import { definition } from "./definition";
export const render = createSSRRender({
    definition: definition(),
    render: (app) => renderToString(createElement(App, { app })),
});
