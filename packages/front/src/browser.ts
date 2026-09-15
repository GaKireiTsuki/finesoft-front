// Browser-only entry — excludes server code (createServer, startServer, etc.)
// Used via package.json "browser" condition to avoid bundling Node.js dependencies.

// ===== Core =====
export * from "@finesoft/core";

// ===== Browser =====
export {
    History,
    SESSION_DEFAULT_DEBOUNCE_MS,
    createDomRestore,
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
    BrowserAppConfig,
    BrowserAppHandle,
    BrowserRenderer,
    RenderContext,
    ViewHandle,
    BrowserSessionConfig,
    DomRestore,
    DomRestoreOptions,
    ExternalUrlDependencies,
    FlowActionCallbacks,
    FlowActionDependencies,
    IslandsShell,
    NavigationBridgeDependencies,
    NavigationHandle,
    SessionBridgeOptions,
    SessionHandle,
} from "@finesoft/browser";
// ResolvedEntry 已移入 @finesoft/core，经上面的 `export * from "@finesoft/core"` 透出（勿在此重复列）。

export * from "@finesoft/web";

export {
    createBrowserContext,
    setHtmlLocaleAttributes,
    getPWADisplayMode,
    resetFilterCache,
    shouldLog,
    IntersectionImpressionObserver,
} from "@finesoft/browser";
export type {
    BrowserContextOptions,
    PWADisplayMode,
    ImpressionObserver,
    ImpressionObserverOptions,
} from "@finesoft/browser";
