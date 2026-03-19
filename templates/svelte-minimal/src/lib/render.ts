import type { BasePage, Framework } from "@finesoft/front";
import { render } from "svelte/server";
import App from "../App.svelte";

export function renderApp(page: BasePage, framework: Framework) {
    const result = render(App, { props: { page, framework } });
    return {
        html: result.body ?? "",
        head: `<title>${page.title}</title>${result.head ?? ""}`,
        css: "",
    };
}
