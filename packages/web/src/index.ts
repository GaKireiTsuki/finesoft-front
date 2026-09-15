export { ActionDispatcher } from "./actions/dispatcher";
export type { ActionHandler } from "./actions/dispatcher";
export { ACTION_KINDS, isCompoundAction } from "./actions/types";
export {
    isExternalUrlAction,
    isFlowAction,
    makeExternalUrlAction,
    makeFlowAction,
} from "./actions/types";
export type { Action, ExternalUrlAction, FlowAction } from "./actions/types";
export type { CompoundAction } from "./actions/types";
export { makeDependencies } from "./dependencies/make-dependencies";
export type { MakeDependenciesOptions } from "./dependencies/make-dependencies";
export { Router } from "./router/router";
export type { RouteAddOptions, RouteMatch } from "./router/router";
export type { RouteParams } from "./router/types";
export { Framework } from "./framework";
export type { FrameworkConfig } from "./framework";
export type { BasePage } from "./models/page";
export {
    BASE_PAGE_FIELDS,
    FINESOFT_PUBLIC,
    getPublicFields,
    isPublicMarked,
    markPublic,
    type PublicProjection,
    type PublicValueCodec,
} from "./models/page";
export { safeErrorPage, type SafeErrorPageOptions } from "./models/safe-error-page";
export type { BaseItem, BaseShelf } from "./models/shelf";
export { PrefetchedIntents } from "./prefetched-intents/prefetched-intents";
export type { PrefetchedIntent } from "./prefetched-intents/prefetched-intents";
export { route } from "./bootstrap/define-routes";
export type { RenderMode } from "./bootstrap/define-routes";
export type { RouteDefinition } from "./bootstrap/define-routes";
export {
    collectAllLeaves,
    collectVisibleDestinations,
    islandContainerAttributes,
    resourceKey,
    createActiveLeafCodec,
    createFlatStackCodec,
    createFullStateCodec,
    createNavigationController,
    decodeNavigationTreeParam,
    DEFAULT_NAV_PARAM,
    deserializeNavigation,
    encodeNavigationTreeParam,
    findNearestStack,
    findNode,
    isLeafNode,
    isSplitNode,
    isStackNode,
    isTabsNode,
    leaf,
    NAVIGATION_NODE_KINDS,
    NAVIGATION_OP_KINDS,
    NavigationError,
    pop,
    popTo,
    popToRoot,
    push,
    replaceTop,
    resolveActivePath,
    selectColumn,
    selectTab,
    serializeNavigation,
    serializeNavigationStable,
    setVisibility,
    split,
    SPLIT_VISIBILITIES,
    stack,
    tabs,
    visibleSplitColumns,
} from "./navigation/index";
export type {
    FullStateCodecOptions,
    HydrateOperation,
    LeafNode,
    NavigationCodec,
    NavigationContextInput,
    NavigationController,
    NavigationControllerOptions,
    NavigationDispatchContext,
    NavigationNode,
    NavigationNodeKind,
    NavigationOpKind,
    NavigationOperation,
    NavigationPath,
    NavigationPathStep,
    NavigationRouterLike,
    NavigationSnapshot,
    Page,
    PopOperation,
    PopToOperation,
    PopToRootOperation,
    PushOperation,
    PushOptions,
    ReplaceTopOperation,
    ResolvedDestination,
    SelectColumnOperation,
    SelectTabOperation,
    SerializedLeaf,
    SerializedNavigation,
    SerializedSplit,
    SerializedSplitColumn,
    SerializedStack,
    SerializedTabs,
    SetVisibilityOperation,
    SplitColumn,
    SplitColumnInit,
    SplitNode,
    SplitVisibility,
    StackNode,
    TabsInit,
    TabsNode,
} from "./navigation/index";
export type { ResolvedEntry } from "./navigation/index";
export {
    collectLeafKeys,
    createNavigationScopedState,
    createNavigationSessionAdapter,
    createSessionStore,
    createUrlSessionAdapter,
    decodeSnapshot,
    encodeSnapshot,
    isUrlLocation,
    SESSION_DEFAULT_KEY,
    SESSION_DEFAULT_VERSION,
    SessionError,
    StorageUnavailableError,
} from "./session/index";
export type {
    NavigationScopedState,
    SessionErrorContext,
    SessionNavigationAdapter,
    SessionSnapshot,
    SessionStateProvider,
    SessionStore,
    SessionStoreOptions,
    AsyncStorage,
    SessionSlice,
    SessionFailure,
    SessionWriteResult,
    SessionLoadResult,
    SessionRestoreResult,
    SessionUrlLocation,
    UrlAdapterOptions,
} from "./session/index";
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
export { resolveConfiguredMessages } from "./i18n/messages";
export type { MessagesLoader, MessagesLoaderContext } from "./i18n/messages";

export * from "./application";

export {
    FRAMEWORK_PROTOCOL_VERSION,
    NAVIGATION_WIRE_INTENT,
    getFrameworkBuildId,
    decodeWireEnvelope,
    type WireEnvelope,
    type WireDecodeResult,
} from "./protocol";

export { resolveInitialNavigation } from "./application/initial-navigation";
