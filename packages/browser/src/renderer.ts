import type { BasePage, Framework, NavigationSnapshot } from "@finesoft/web";
import type { BrowserAppHandle } from "./start-app";
export interface RenderContext {
    readonly framework: Framework;
    readonly app?: BrowserAppHandle;
    readonly snapshot: NavigationSnapshot;
}
export interface ViewHandle {
    update(page: BasePage): void | Promise<void>;
    dispose(): void | Promise<void>;
}
export interface BrowserRenderer {
    readonly mode?: "root" | "entries";
    mount: (options: {
        target: HTMLElement;
        page: BasePage;
        context: RenderContext;
        hydrate: boolean;
    }) => ViewHandle | Promise<ViewHandle>;
    mountChrome?: (options: {
        target: HTMLElement;
        page: BasePage;
        context: RenderContext;
        hydrate: boolean;
    }) => ViewHandle | Promise<ViewHandle>;
}
