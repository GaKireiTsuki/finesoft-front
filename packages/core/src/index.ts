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
    FeatureFlagsProvider,
    Logger,
    MakeDependenciesOptions,
    MetricsRecorder,
    Net,
    Storage,
    TranslationMessages,
} from "./dependencies/make-dependencies";

// ===== Router =====
export { Router } from "./router/router";
export type { RouteAddOptions, RouteMatch } from "./router/router";

// ===== Logger =====
export { BaseLogger } from "./logger/base";
export { CompositeLogger, CompositeLoggerFactory } from "./logger/composite";
export { ConsoleLogger, ConsoleLoggerFactory } from "./logger/console";
export { resetFilterCache, shouldLog } from "./logger/local-storage-filter";
export {
    ReportingLogger,
    ReportingLoggerFactory,
    type ReportCallback,
    type ReportingLoggerOptions,
} from "./logger/reporting";
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
export type { HttpClientConfig, RequestInterceptor, ResponseInterceptor } from "./http/client";

// ===== Base Controller =====
export { BaseController } from "./intents/base-controller";

// ===== Data / Mapper =====
export { mapEach, pipe, pipeAsync } from "./data/mapper";
export type { AsyncMapper, Mapper } from "./data/mapper";

// ===== Bootstrap =====
export {
    defineBootstrap,
    getBootstrapConfig,
    type BootstrapRuntimeConfig,
    type FrameworkBootstrap,
} from "./bootstrap/define-bootstrap";
export { defineRoutes } from "./bootstrap/define-routes";
export type { DefineRoutesOptions, RenderMode, RouteDefinition } from "./bootstrap/define-routes";

// ===== Utils =====
export { LruMap } from "./utils/lru-map";
export { isNone, isSome, type None, type Optional } from "./utils/optional";
export { detectPlatform, type PlatformInfo } from "./utils/platform";
export { getPWADisplayMode, type PWADisplayMode } from "./utils/pwa";
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

// ===== Metrics =====
export { CompositeEventRecorder } from "./metrics/composite-recorder";
export { ConsoleEventRecorder } from "./metrics/console-recorder";
export {
    IntersectionImpressionObserver,
    type ImpressionObserverOptions,
} from "./metrics/impression-observer";
export type {
    EventRecorder,
    ImpressionEntry,
    ImpressionObserver,
    MetricsFieldsProvider,
} from "./metrics/types";
export { VoidEventRecorder } from "./metrics/void-recorder";
export { WithFieldsRecorder } from "./metrics/with-fields-recorder";

// ===== i18n =====
export {
    englishPlural,
    interpolate,
    resolvePluralKey,
    type PluralCategory,
    type PluralRuleProvider,
} from "./i18n/interpolate";
export {
    getLocaleAttributes,
    getTextDirection,
    isRtl,
    makeLocaleInfo,
    resolveLocaleFromUrl,
    setHtmlLocaleAttributes,
} from "./i18n/locale";
export { resolveConfiguredMessages, resolveMessages } from "./i18n/messages";
export type { MessagesLoader, MessagesLoaderContext } from "./i18n/messages";
export { SimpleTranslator, type SimpleTranslatorOptions } from "./i18n/translator";
export type { LocaleAttributes, LocaleInfo, TextDirection, Translator } from "./i18n/types";
