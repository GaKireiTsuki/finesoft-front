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
    createBrowserApp,
    tryScroll,
} from "@finesoft/browser";
export type {
    BrowserAppConfig,
    BrowserAppHandle,
    BrowserSessionConfig,
    DomRestore,
    DomRestoreOptions,
    NavigationBridgeDependencies,
    NavigationBridge,
    SessionBridgeOptions,
    BrowserSession,
} from "@finesoft/browser";

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
