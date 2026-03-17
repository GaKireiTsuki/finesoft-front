// ===== Actions =====
export { ActionDispatcher } from "./actions/dispatcher";
export type { ActionHandler } from "./actions/dispatcher";
export {
    ACTION_KINDS,
    isCompoundAction,
    isExternalUrlAction,
    isFlowAction,
    makeExternalUrlAction,
    makeFlowAction,
} from "./actions/types";
export type { Action, CompoundAction, ExternalUrlAction, FlowAction } from "./actions/types";

// ===== Intents =====
export { IntentDispatcher } from "./intents/dispatcher";
export type { Intent, IntentController } from "./intents/types";

// ===== Dependencies =====
export { Container } from "./dependencies/container";
export { DEP_KEYS, makeDependencies } from "./dependencies/make-dependencies";
export type {
    FeatureFlags,
    Logger,
    MetricsRecorder,
    Net,
    Storage,
} from "./dependencies/make-dependencies";

// ===== Router =====
export { Router } from "./router/router";
export type { RouteAddOptions, RouteMatch } from "./router/router";

// ===== Logger =====
export { BaseLogger } from "./logger/base";
export { CompositeLogger, CompositeLoggerFactory } from "./logger/composite";
export { ConsoleLogger, ConsoleLoggerFactory } from "./logger/console";
export { resetFilterCache, shouldLog } from "./logger/local-storage-filter";
export type { LoggerFactory, Logger as LoggerInterface } from "./logger/types";

// ===== Framework =====
export { Framework } from "./framework";
export type { FrameworkConfig } from "./framework";

// ===== Models =====
export type { BasePage } from "./models/page";
export type { BaseItem, BaseShelf } from "./models/shelf";

// ===== Prefetched Intents =====
export { PrefetchedIntents } from "./prefetched-intents/prefetched-intents";
export type { PrefetchedIntent } from "./prefetched-intents/prefetched-intents";
export { stableStringify } from "./prefetched-intents/stable-stringify";

// ===== HTTP =====
export { HttpClient, HttpError } from "./http/client";
export type { HttpClientConfig } from "./http/client";

// ===== Base Controller =====
export { BaseController } from "./intents/base-controller";

// ===== Data / Mapper =====
export { mapEach, pipe, pipeAsync } from "./data/mapper";
export type { AsyncMapper, Mapper } from "./data/mapper";

// ===== Bootstrap =====
export { defineRoutes } from "./bootstrap/define-routes";
export type { RenderMode, RouteDefinition } from "./bootstrap/define-routes";

// ===== Utils =====
export { LruMap } from "./utils/lru-map";
export { isNone, isSome, type None, type Optional } from "./utils/optional";
export { buildUrl, getBaseUrl, removeHost, removeQueryParams, removeScheme } from "./utils/url";
export { generateUuid } from "./utils/uuid";

// ===== Middleware =====
export { createBrowserContext, createServerContext } from "./middleware/context";
export type { BrowserContextOptions, ServerContextOptions } from "./middleware/context";
export { runAfterLoadGuards, runBeforeLoadGuards } from "./middleware/pipeline";
export { deny, next, redirect, rewrite } from "./middleware/types";
export type {
    AfterLoadGuard,
    BeforeLoadGuard,
    DenyResult,
    MiddlewareResult,
    NavigationContext,
    NextResult,
    PostLoadContext,
    RedirectResult,
    RewriteResult,
} from "./middleware/types";
