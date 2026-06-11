// Browser-only entry — excludes server code (createServer, startServer, etc.)
// Used via package.json "browser" condition to avoid bundling Node.js dependencies.

// ===== Core =====
export * from "@finesoft/core";

// ===== Browser =====
export {
    History,
    SESSION_DEFAULT_DEBOUNCE_MS,
    createAppHandle,
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
    resolveIslandsShell,
    startBrowserApp,
    tryScroll,
} from "@finesoft/browser";
export type {
    ActionHandlerDependencies,
    AppHandle,
    BrowserAppConfig,
    BrowserNavigationConfig,
    BrowserSessionConfig,
    DomRestore,
    DomRestoreOptions,
    ExternalUrlDependencies,
    FlowActionCallbacks,
    FlowActionDependencies,
    IslandHandle,
    IslandsShell,
    IslandOrchestrator,
    IslandOrchestratorOptions,
    MountEntry,
    NavigationBridgeDependencies,
    NavigationHandle,
    SessionBridgeOptions,
    SessionHandle,
} from "@finesoft/browser";
// ResolvedEntry 已移入 @finesoft/core，经上面的 `export * from "@finesoft/core"` 透出（勿在此重复列）。
