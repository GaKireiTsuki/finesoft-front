/// <reference types="./shims/server-peer-modules.d.ts" />

// ===== Core =====
export * from "@finesoft/core";

// ===== Browser (unique exports only) =====
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

// ===== SSR (unique exports only) =====
export {
    SSR_PLACEHOLDERS,
    createSSRRender,
    injectCSRShell,
    injectSSRContent,
    serializeServerData,
    ssrRender,
} from "@finesoft/ssr";
export type {
    InjectSSROptions,
    SSRContext,
    SSRRenderConfig,
    SSRRenderOptions,
    SSRRenderResult,
} from "@finesoft/ssr";

// ===== Server =====
export * from "@finesoft/server";
