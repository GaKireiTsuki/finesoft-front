// Browser-only entry — excludes server code (createServer, startServer, etc.)
// Used via package.json "browser" condition to avoid bundling Node.js dependencies.

// ===== Core =====
export * from "@finesoft/core";

// ===== Browser =====
export {
    History,
    createPrefetchedIntentsFromDom,
    deserializeServerData,
    extractI18nFromDom,
    registerActionHandlers,
    registerExternalUrlHandler,
    registerFlowActionHandler,
    startBrowserApp,
    tryScroll,
} from "@finesoft/browser";
export type {
    ActionHandlerDependencies,
    BrowserAppConfig,
    ExternalUrlDependencies,
    FlowActionCallbacks,
    FlowActionDependencies,
} from "@finesoft/browser";
