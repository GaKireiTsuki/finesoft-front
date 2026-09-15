import type { Action, BasePage, Framework, NavigationSnapshot } from "@finesoft/web";
import type { BrowserAppHandle, RenderContext } from "@finesoft/browser";
export interface ViewProps {
    page: BasePage;
    context: RenderContext;
    framework: Framework;
    onAction: (action: Action) => void;
    controller?: BrowserAppHandle;
    initialSnapshot: NavigationSnapshot;
}
export interface RendererOptions<View> {
    readonly views: Readonly<Record<string, View>>;
    readonly mode?: "root" | "entries";
    readonly chrome?: View;
    readonly props?: (props: ViewProps) => Record<string, unknown>;
}
export function viewProps(page: BasePage, context: RenderContext): ViewProps {
    return {
        page,
        context,
        framework: context.framework,
        controller: context.app,
        initialSnapshot: context.snapshot,
        onAction: (action) => {
            void context.framework.perform(action);
        },
    };
}
export function selectView<View>(options: RendererOptions<View>, page: BasePage): View {
    const view = options.views[page.pageType] ?? options.views["*"];
    if (!view) throw Error("Missing view: " + page.pageType);
    return view;
}
