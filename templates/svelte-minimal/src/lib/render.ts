import type { BasePage } from "@finesoft/front";
import { render } from "svelte/server";
import App from "../App.svelte";

export function renderApp(page: BasePage) {
    const result = render(App, { props: { page } });
    return {
        html: result.body ?? "",
        head: `<title>${page.title}</title>${result.head ?? ""}`,
        css: "",
    };
}
