/// <reference types="./shims/server-peer-modules.d.ts" />

// ===== Core =====
export * from "@finesoft/core";

// ===== Browser (unique exports only) =====
export {
    History,
    createNavigationBridge,
    createPrefetchedIntentsFromDom,
    deserializeServerData,
    registerActionHandlers,
    registerExternalUrlHandler,
    registerFlowActionHandler,
    startBrowserApp,
    tryScroll,
} from "@finesoft/browser";
export type {
    ActionHandlerDependencies,
    BrowserAppConfig,
    BrowserNavigationConfig,
    ExternalUrlDependencies,
    FlowActionCallbacks,
    FlowActionDependencies,
    NavigationBridgeDependencies,
    NavigationHandle,
} from "@finesoft/browser";

// ===== SSR (unique exports only) =====
export {
    SSR_PLACEHOLDERS,
    createSSRNavigationRender,
    createSSRRender,
    extractNavigationTree,
    injectCSRShell,
    injectSSRContent,
    NAVIGATION_TREE_INTENT_ID,
    serializeServerData,
    ssrRender,
    ssrRenderNavigation,
    stripNavigationTree,
} from "@finesoft/ssr";
export type {
    InjectSSROptions,
    SerializedNavigationTreePayload,
    SerializeServerDataOptions,
    SSRContext,
    SSRNavigationDefinition,
    SSRNavigationRenderConfig,
    SSRRenderConfig,
    SSRRenderNavigationOptions,
    SSRRenderNavigationResult,
    SSRRenderOptions,
    SSRRenderResult,
} from "@finesoft/ssr";

// ===== Server =====
export * from "@finesoft/server";
