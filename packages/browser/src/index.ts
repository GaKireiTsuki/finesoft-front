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
export { startBrowserApp, type BrowserAppConfig } from "./start-app";

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
