import { createSSRNavigationRender, renderIslandsHtml, type SSRAppResult } from "@finesoft/ssr";
import type { BasePage, WebAppDefinition } from "@finesoft/web";
import { selectView, viewProps, type RendererOptions, type ViewProps } from "./types";
const escape = (value: string) =>
    value.replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
    );
export function createNativeSSRRender<View>(
    config: { app: WebAppDefinition; renderer: RendererOptions<View> },
    render: (view: View, props: ViewProps & Record<string, unknown>) => Promise<SSRAppResult>,
) {
    const { app, renderer } = config;
    const renderPage = createSSRNavigationRender({
        definition: app,
        loadMessages: app.loadMessages,
        async renderApp(page, framework, snapshot) {
            const context = { framework, snapshot };
            const output = async (view: View, page: BasePage) => {
                const props = viewProps(page, context);
                return render(view, { ...props, ...renderer.props?.(props) });
            };
            let result: SSRAppResult;
            if (renderer.mode === "entries") {
                const chrome = renderer.chrome
                    ? await output(renderer.chrome, page)
                    : { html: "", head: "", css: "" };
                let css = chrome.css,
                    head = chrome.head;
                const html = await renderIslandsHtml(snapshot, async (entry) => {
                    const result = await output(selectView(renderer, entry.page), entry.page);
                    css += result.css;
                    head += result.head;
                    return result.html;
                });
                result = {
                    html:
                        "<div data-fs-chrome>" +
                        chrome.html +
                        "</div><main data-fs-outlet>" +
                        html +
                        "</main>",
                    css,
                    head,
                };
            } else result = await output(selectView(renderer, page), page);
            return {
                ...result,
                head:
                    "<title>" +
                    escape(page.title) +
                    '</title><meta name="description" content="' +
                    escape(page.description ?? "") +
                    '">' +
                    result.head,
            };
        },
    });
    return renderPage;
}
