// Browser-only entry — excludes server code (createServer, startServer, etc.)
// Used via package.json "browser" condition to avoid bundling Node.js dependencies.

// ===== Core =====
export * from "@finesoft/core";

// ===== Browser =====
export {
    History,
    KeepAliveController,
    createPrefetchedIntentsFromDom,
    deserializeServerData,
    registerActionHandlers,
    registerExternalUrlHandler,
    registerFlowActionHandler,
    startBrowserApp,
    toKeepAliveCacheKey,
    tryScroll,
} from "@finesoft/browser";
export type {
    ActionHandlerDependencies,
    BrowserAppConfig,
    BrowserMountContext,
    BrowserNavigationType,
    BrowserUpdateAppProps,
    ExternalUrlDependencies,
    FlowActionCallbacks,
    FlowActionDependencies,
    KeepAliveEntry,
    KeepAliveEvent,
    KeepAliveMatch,
    KeepAliveOptions,
} from "@finesoft/browser";
