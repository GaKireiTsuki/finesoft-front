// ===== Action Handlers =====
export {
    registerExternalUrlHandler,
    type ExternalUrlDependencies,
} from "./action-handlers/external-url-action";
export {
    registerFlowActionHandler,
    type FlowActionCallbacks,
    type FlowActionDependencies,
} from "./action-handlers/flow-action";
export { registerActionHandlers, type ActionHandlerDependencies } from "./action-handlers/register";

// ===== Browser App =====
export {
    startBrowserApp,
    type BrowserAppConfig,
    type BrowserAppHandle,
    type BrowserSessionConfig,
} from "./start-app";

// ===== Navigation Bridge =====
export {
    createNavigationBridge,
    type NavigationBridgeDependencies,
    type NavigationHandle,
} from "./navigation-bridge";

// ===== Navigation Islands =====
export type { ResolvedEntry } from "@finesoft/web";
export type { BrowserRenderer, RenderContext, ViewHandle } from "./renderer";
export { resolveIslandsShell, type IslandsShell } from "./islands-shell";

// ===== Session =====
export {
    createSessionBridge,
    defaultShouldRestore,
    SESSION_DEFAULT_DEBOUNCE_MS,
    type SessionBridgeOptions,
    type SessionHandle,
} from "./session-bridge";
export { createWebStorage, type WebStorageKind } from "./web-storage";

// ===== DOM Restore =====
export { createDomRestore, type DomRestore, type DomRestoreOptions } from "./dom-restore";

// ===== Browser Utils =====
export { History } from "./utils/history";
export { tryScroll } from "./utils/try-scroll";

// ===== Server Data (browser side) =====
export { createPrefetchedIntentsFromDom, deserializeServerData } from "./server-data";

// ===== Re-exports from @finesoft/core (convenience) =====
export { BaseController, HttpClient, HttpError } from "@finesoft/core";
export { Framework } from "@finesoft/web";
export {
    isExternalUrlAction,
    isFlowAction,
    makeExternalUrlAction,
    makeFlowAction,
} from "@finesoft/web";
export type {
    Action,
    BaseItem,
    BaseShelf,
    ExternalUrlAction,
    FlowAction,
    RouteDefinition,
} from "@finesoft/web";
export type { BasePage } from "@finesoft/web";
export type { Container, Intent } from "@finesoft/core";

export { resetFilterCache, shouldLog } from "./logger/local-storage-filter";
export { getPWADisplayMode, type PWADisplayMode } from "./utils/pwa";
export {
    IntersectionImpressionObserver,
    type ImpressionObserverOptions,
} from "./metrics/impression-observer";
export { setHtmlLocaleAttributes } from "./i18n/locale";
export type { ImpressionObserver } from "./metrics/types";
export { createBrowserContext, type BrowserContextOptions } from "./middleware/context";
