export { createSSRRender, type SSRRenderConfig } from "./create-render";
export {
    injectCSRShell,
    injectSSRContent,
    SSR_PLACEHOLDERS,
    type InjectSSROptions,
} from "./inject";
export {
    createSSRNavigationRender,
    extractNavigationTree,
    NAVIGATION_TREE_INTENT_ID,
    ssrRenderNavigation,
    stripNavigationTree,
    type SerializedNavigationTreePayload,
    type SSRNavigationDefinition,
    type SSRNavigationRenderConfig,
    type SSRRenderNavigationOptions,
    type SSRRenderNavigationResult,
} from "./navigation";
export {
    ssrRender,
    type SSRAppResult,
    type SSRContext,
    type SSRRenderOptions,
    type SSRRenderResult,
} from "./render";
export {
    materializeServerData,
    serializeServerData,
    type SerializeServerDataOptions,
} from "./server-data";

export { renderIslandsHtml, type RenderEntry } from "./islands";

// ===== Re-exports from @finesoft/core (convenience) =====
export { Framework } from "@finesoft/web";
export type { BasePage } from "@finesoft/web";
export { createServerContext, type ServerContextOptions } from "./middleware/context";
