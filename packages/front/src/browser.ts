// Browser-only entry — excludes server code (createServer, startServer, etc.)
// Used via package.json "browser" condition to avoid bundling Node.js dependencies.

// ===== Core =====
export * from "@finesoft/core";

// ===== Browser =====
export {
    History,
    SESSION_DEFAULT_DEBOUNCE_MS,
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
    ExternalUrlDependencies,
    FlowActionCallbacks,
    FlowActionDependencies,
    IslandHandle,
    IslandOrchestrator,
    IslandOrchestratorOptions,
    MountEntry,
    NavigationBridgeDependencies,
    NavigationHandle,
    ResolvedEntry,
    SessionBridgeOptions,
    SessionHandle,
} from "@finesoft/browser";
