/// <reference types="./shims/server-peer-modules.d.ts" />

// ===== Core =====
export * from "@finesoft/core";

// ===== Browser (unique exports only) =====
export {
    History,
    SESSION_DEFAULT_DEBOUNCE_MS,
    createDomRestore,
    createIslandOrchestrator,
    createNavigationBridge,
    createPrefetchedIntentsFromDom,
    createSessionBridge,
    createWebStorage,
    defaultShouldRestore,
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
    BrowserSessionConfig,
    DomRestore,
    DomRestoreOptions,
    ExternalUrlDependencies,
    FlowActionCallbacks,
    FlowActionDependencies,
    IslandHandle,
    IslandOrchestrator,
    IslandOrchestratorOptions,
    MountEntry,
    NavigationBridgeDependencies,
    NavigationHandle,
    SessionBridgeOptions,
    SessionHandle,
} from "@finesoft/browser";
// 注：ResolvedEntry 已移入 @finesoft/core，经上面的 `export * from "@finesoft/core"` 透出。

// ===== SSR (unique exports only) =====
export {
    SSR_PLACEHOLDERS,
    createSSRNavigationRender,
    createSSRRender,
    extractNavigationTree,
    injectCSRShell,
    injectSSRContent,
    NAVIGATION_TREE_INTENT_ID,
    renderIslandsHtml,
    serializeServerData,
    ssrRender,
    ssrRenderNavigation,
    stripNavigationTree,
} from "@finesoft/ssr";
export type {
    InjectSSROptions,
    RenderEntry,
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
