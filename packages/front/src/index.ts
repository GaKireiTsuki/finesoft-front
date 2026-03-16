/// <reference types="./shims/server-peer-modules.d.ts" />

// ===== Core =====
export * from "@finesoft/core";

// ===== Browser (unique exports only) =====
export {
    createPrefetchedIntentsFromDom,
    deserializeServerData,
    History,
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
    createSSRRender,
    injectCSRShell,
    injectSSRContent,
    serializeServerData,
    SSR_PLACEHOLDERS,
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
