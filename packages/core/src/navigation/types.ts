/**
 * Navigation — 类型定义
 *
 * 给内容无关的 SSR/CSR 框架增加结构化导航能力，对标 SwiftUI 的
 * NavigationStack / TabView / NavigationSplitView —— 但不含任何 UI。
 * 框架持有导航的「状态 + 语义 + URL/history/SSR 集成」，应用自行决定如何渲染，
 * `Page` 保持 `unknown`。
 *
 * 模型是一棵递归导航树（可辨识联合）：叶子是导航目标（intent + params），
 * 内部节点递归组合（tabs of stacks；detail 列是 stack 的 split；……），
 * 与 SwiftUI 的组合方式一致。单个 LeafNode 树即为今天的扁平单页行为（向后兼容）。
 */

import type { BasePage } from "../models/page";
import type { RouteParams } from "../router/types";

/**
 * 导航树里 `Page` 的别名 —— 运行期 dispatch 始终产出 `BasePage`，
 * 但导航层对内容无关，字段语义由应用决定。
 */
export type Page = BasePage;

/** 导航节点 Kind 常量 */
export const NAVIGATION_NODE_KINDS = {
    LEAF: "leaf",
    STACK: "stack",
    TABS: "tabs",
    SPLIT: "split",
} as const;

/** 所有导航节点 Kind 的联合类型 */
export type NavigationNodeKind = (typeof NAVIGATION_NODE_KINDS)[keyof typeof NAVIGATION_NODE_KINDS];

/** 叶子：一个具体导航目标 */
export interface LeafNode {
    readonly kind: typeof NAVIGATION_NODE_KINDS.LEAF;
    readonly intent: string;
    readonly params: RouteParams;
}

/** 栈：有序路径，entries[0]=根，末尾=栈顶（可见） */
export interface StackNode {
    readonly kind: typeof NAVIGATION_NODE_KINDS.STACK;
    readonly entries: readonly NavigationNode[];
}

/** Tabs：并列分支 + 当前激活键 + 稳定顺序；仅激活分支可见 */
export interface TabsNode {
    readonly kind: typeof NAVIGATION_NODE_KINDS.TABS;
    readonly active: string;
    readonly order: readonly string[];
    readonly branches: Readonly<Record<string, NavigationNode>>;
}

/** Split 列：列 id + 该列内容（undefined = 尚未选择） */
export interface SplitColumn {
    readonly id: string;
    readonly content: NavigationNode | undefined;
}

/**
 * Split 列可见性，对标 SwiftUI `NavigationSplitViewVisibility`。
 *
 * 这是**可绑定 / 可序列化 / 可恢复的导航状态**（不是渲染样式）：它决定哪些列算「可见」，
 * 进而影响 `collectVisibleDestinations` 与 SSR 预取——例如深链到 `detailOnly` 时服务端只预取 detail 列。
 *
 * - `automatic`（缺省）：框架不裁剪，所有有内容的列都可见（SSR 端无视口信息时的安全默认；客户端再按视口自适应）。
 * - `all`：显式所有列可见（语义同 automatic 的全列）。
 * - `doubleColumn`：仅首列 + 末列可见（三列时隐藏中间 content 列）。
 * - `detailOnly`：仅末列（detail）可见。
 *
 * 注意：compact 视口塌缩成单栈（SwiftUI 的 `preferredCompactColumn`）是视口反应式的纯渲染决策，
 * 框架不建模，交给应用按 `getPlatform()` / 视口自行处理。
 */
export const SPLIT_VISIBILITIES = {
    AUTOMATIC: "automatic",
    ALL: "all",
    DOUBLE_COLUMN: "doubleColumn",
    DETAIL_ONLY: "detailOnly",
} as const;

/** Split 列可见性的联合类型 */
export type SplitVisibility = (typeof SPLIT_VISIBILITIES)[keyof typeof SPLIT_VISIBILITIES];

/**
 * Split：多列并存，列间通过 selectColumn 设置后续列内容。
 * `visibility` 决定哪些列算可见（缺省 `automatic` = 全列），是可序列化的导航状态。
 */
export interface SplitNode {
    readonly kind: typeof NAVIGATION_NODE_KINDS.SPLIT;
    readonly columns: readonly SplitColumn[];
    readonly visibility?: SplitVisibility;
}

/** 所有导航节点的联合类型 */
export type NavigationNode = LeafNode | StackNode | TabsNode | SplitNode;

/** 指向树中某节点的路径（从根到目标）的一步 */
export type NavigationPathStep =
    | { readonly kind: "stack-entry"; readonly index: number }
    | { readonly kind: "tab"; readonly key: string }
    | { readonly kind: "column"; readonly id: string };

/** 指向树中某节点的完整路径（从根到目标） */
export type NavigationPath = readonly NavigationPathStep[];

/** 单个可见目标的解析结果 */
export interface ResolvedDestination {
    readonly intent: string;
    readonly params: RouteParams;
    readonly page: Page;
    readonly status?: number;
}

/** 导航快照：当前树 + 所有可见目标解析结果（顺序与 collectVisibleDestinations 一致） */
export interface NavigationSnapshot {
    readonly tree: NavigationNode;
    readonly destinations: readonly ResolvedDestination[];
}

/** 错误类型：序列化 / 路径 / 操作非法时抛出 */
export class NavigationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "NavigationError";
    }
}
