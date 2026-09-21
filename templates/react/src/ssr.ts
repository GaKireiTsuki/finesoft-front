import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { createSSRRender } from "@finesoft/front";
import { app } from "./app-definition";
import App from "./App";

export const render = createSSRRender({
    definition: app,
    render: (app) => renderToString(createElement(App, { app })),
});
export { serializeServerData } from "@finesoft/front";
