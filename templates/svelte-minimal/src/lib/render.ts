import type { BasePage } from "@finesoft/front";
import { render } from "svelte/server";
import App from "../App.svelte";

export function renderApp(page: BasePage, _locale: string) {
    const result = render(App, { props: { page } });
    return {
        html: result.body ?? "",
        head: `<title>${page.title}</title>${result.head ?? ""}`,
        css: "",
    };
}
