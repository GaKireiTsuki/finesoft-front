// ===== Browser App =====
export {
    createBrowserApp,
    type BrowserAppConfig,
    type BrowserAppHandle,
    type BrowserSessionConfig,
} from "./start-app";

// ===== Navigation Bridge =====
export {
    createNavigationBridge,
    type NavigationBridgeDependencies,
    type NavigationBridge,
} from "./navigation-bridge";

// ===== Session =====
export {
    createSessionBridge,
    defaultShouldRestore,
    SESSION_DEFAULT_DEBOUNCE_MS,
    type SessionBridgeOptions,
    type BrowserSession,
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
export {
    isExternalUrlAction,
    isFlowAction,
    makeExternalUrlAction,
    makeFlowAction,
} from "@finesoft/web";
export type { Action, ExternalUrlAction, FlowAction, RouteDefinition } from "@finesoft/web";
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
