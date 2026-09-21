import { createSSRRender } from "@finesoft/front";
import { renderToString } from "react-dom/server";
import { app } from "./app-definition";
import App from "./App";
export const render = createSSRRender({
    definition: app,
    render: (app) => renderToString(<App app={app} />),
});
export { serializeServerData } from "@finesoft/front";
