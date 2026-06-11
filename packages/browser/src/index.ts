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
    type BrowserNavigationConfig,
    type BrowserSessionConfig,
} from "./start-app";

// ===== Navigation Bridge =====
export {
    createNavigationBridge,
    type NavigationBridgeDependencies,
    type NavigationHandle,
} from "./navigation-bridge";

// ===== Navigation Islands =====
export {
    createIslandOrchestrator,
    type IslandHandle,
    type IslandOrchestrator,
    type IslandOrchestratorOptions,
    type MountEntry,
    type ResolvedEntry,
} from "./navigation-islands";

// ===== Session =====
export {
    createSessionBridge,
    defaultShouldRestore,
    SESSION_DEFAULT_DEBOUNCE_MS,
    type SessionBridgeOptions,
    type SessionHandle,
} from "./session-bridge";
export { createWebStorage, type WebStorageKind } from "./web-storage";

// ===== Browser Utils =====
export { History } from "./utils/history";
export { tryScroll } from "./utils/try-scroll";

// ===== Server Data (browser side) =====
export { createPrefetchedIntentsFromDom, deserializeServerData } from "./server-data";

// ===== Re-exports from @finesoft/core (convenience) =====
export {
    BaseController,
    Framework,
    HttpClient,
    HttpError,
    defineRoutes,
    isExternalUrlAction,
    isFlowAction,
    makeExternalUrlAction,
    makeFlowAction,
} from "@finesoft/core";
export type {
    Action,
    BaseItem,
    BasePage,
    BaseShelf,
    Container,
    ExternalUrlAction,
    FlowAction,
    Intent,
    RouteDefinition,
} from "@finesoft/core";
