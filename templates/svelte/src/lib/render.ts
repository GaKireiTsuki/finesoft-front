import type { BasePage } from "@finesoft/front";
import { render } from "svelte/server";
import App from "../App.svelte";
import type { AppPage } from "./models/product";

export function renderApp(page: BasePage, _locale: string) {
    const result = render(App, { props: { page: page as AppPage } });
    return {
        html: result.body ?? "",
        head: `<title>${page.title}</title><meta name="description" content="${
            page.description ?? ""
        }">${result.head ?? ""}`,
        css: "",
    };
}
