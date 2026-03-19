import type { BasePage, Framework } from "@finesoft/front";
import { render } from "svelte/server";
import App from "../App.svelte";
import type { AppPage } from "./models/product";

export function renderApp(page: BasePage, framework: Framework) {
    const result = render(App, { props: { page: page as AppPage, framework } });
    return {
        html: result.body ?? "",
        head: `<title>${page.title}</title><meta name="description" content="${
            page.description ?? ""
        }">${result.head ?? ""}`,
        css: "",
    };
}
