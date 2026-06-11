/**
 * Navigation barrel —— 结构化导航树（类型 / 构造器 / 纯操作 / 序列化 / codec / controller）
 */

// ===== Types =====
export {
    NAVIGATION_NODE_KINDS,
    NavigationError,
    SPLIT_VISIBILITIES,
    type LeafNode,
    type NavigationNode,
    type NavigationNodeKind,
    type NavigationPath,
    type NavigationPathStep,
    type NavigationSnapshot,
    type Page,
    type ResolvedDestination,
    type SplitColumn,
    type SplitNode,
    type SplitVisibility,
    type StackNode,
    type TabsNode,
} from "./types";

// ===== Nodes（构造器 + 守卫）=====
export {
    isLeafNode,
    isSplitNode,
    isStackNode,
    isTabsNode,
    leaf,
    split,
    stack,
    tabs,
    type SplitColumnInit,
    type TabsInit,
} from "./nodes";

// ===== Keys（稳定身份键）=====
export { entryKey } from "./keys";

// ===== Operations（纯函数）=====
export {
    collectAllLeaves,
    collectVisibleDestinations,
    findNearestStack,
    findNode,
    pop,
    popTo,
    popToRoot,
    push,
    replaceTop,
    resolveActivePath,
    selectColumn,
    selectTab,
    setVisibility,
    visibleSplitColumns,
} from "./operations";

// ===== Serialization =====
export {
    deserializeNavigation,
    serializeNavigation,
    serializeNavigationStable,
    type SerializedLeaf,
    type SerializedNavigation,
    type SerializedSplit,
    type SerializedSplitColumn,
    type SerializedStack,
    type SerializedTabs,
} from "./serialization";

// ===== Codec（URL 编解码）=====
export {
    createActiveLeafCodec,
    createFlatStackCodec,
    createFullStateCodec,
    decodeNavigationTreeParam,
    DEFAULT_NAV_PARAM,
    encodeNavigationTreeParam,
    type FullStateCodecOptions,
    type NavigationCodec,
    type NavigationRouterLike,
} from "./codec";

// ===== Controller（导航控制器）=====
export {
    createNavigationController,
    NAVIGATION_OP_KINDS,
    type HydrateOperation,
    type NavigationContextInput,
    type NavigationController,
    type NavigationControllerOptions,
    type NavigationDispatchContext,
    type NavigationOperation,
    type NavigationOpKind,
    type PopOperation,
    type PopToOperation,
    type PopToRootOperation,
    type PushOperation,
    type PushOptions,
    type ReplaceTopOperation,
    type SelectColumnOperation,
    type SelectTabOperation,
    type SetVisibilityOperation,
} from "./controller";
