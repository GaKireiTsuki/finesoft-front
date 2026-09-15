// Browser host plus portable Web declarations; explicitly selected by the consumer.

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
    registerExternalUrlHandler,
    resolveIslandsShell,
    startBrowserApp,
    tryScroll,
} from "@finesoft/browser";
export type {
    BrowserAppConfig,
    BrowserAppHandle,
    BrowserRenderer,
    RenderContext,
    ViewHandle,
    BrowserSessionConfig,
    DomRestore,
    DomRestoreOptions,
    ExternalUrlDependencies,
    IslandsShell,
    NavigationBridgeDependencies,
    NavigationHandle,
    SessionBridgeOptions,
    SessionHandle,
} from "@finesoft/browser";
// ResolvedEntry is owned by Web and exported below.

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
