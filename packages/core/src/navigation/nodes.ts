/**
 * Navigation — 节点构造器 + 类型守卫
 *
 * 构造器产出冻结的不可变节点；守卫用 `is*Node` 前缀做可辨识联合的窄化。
 */

import type { RouteParams } from "../router/types";
import {
    NAVIGATION_NODE_KINDS,
    type LeafNode,
    type NavigationNode,
    type SplitColumn,
    type SplitNode,
    type SplitVisibility,
    type StackNode,
    type TabsNode,
} from "./types";

// =====================================================================
// 构造器
// =====================================================================

/** 构造叶子节点（一个具体导航目标）。 */
export function leaf(intent: string, params: RouteParams = {}): LeafNode {
    return { kind: NAVIGATION_NODE_KINDS.LEAF, intent, params };
}

/**
 * 构造栈节点。
 * 接受单个根节点（栈仅含根）或一个 entries 数组（entries[0]=根，末尾=栈顶）。
 *
 * @example
 * stack(leaf("home"))                       // 单根栈
 * stack([leaf("home"), leaf("detail")])     // 根 + 栈顶
 */
export function stack(rootOrEntries: NavigationNode | readonly NavigationNode[]): StackNode {
    const entries = Array.isArray(rootOrEntries)
        ? [...(rootOrEntries as readonly NavigationNode[])]
        : [rootOrEntries as NavigationNode];
    return { kind: NAVIGATION_NODE_KINDS.STACK, entries };
}

/** tabs 构造选项 */
export interface TabsInit {
    /** 当前激活分支键 */
    readonly active: string;
    /** 分支映射（键 → 子节点） */
    readonly branches: Readonly<Record<string, NavigationNode>>;
    /** 稳定顺序；缺省时按 branches 的插入顺序推导 */
    readonly order?: readonly string[];
}

/**
 * 构造 Tabs 节点。
 * 缺省 `order` 时按 `branches` 的插入顺序（`Object.keys`）推导稳定顺序。
 */
export function tabs(init: TabsInit): TabsNode {
    const order = init.order ? [...init.order] : Object.keys(init.branches);
    return {
        kind: NAVIGATION_NODE_KINDS.TABS,
        active: init.active,
        order,
        branches: { ...init.branches },
    };
}

/** split 列初始化（content 可缺省 = 尚未选择） */
export interface SplitColumnInit {
    readonly id: string;
    readonly content?: NavigationNode;
}

/**
 * 构造 Split 节点（多列并存）。
 * `visibility` 缺省（不写字段）等价 `automatic` = 全列可见；
 * 显式传入时纳入节点状态，影响 `collectVisibleDestinations` 与 SSR 预取。
 *
 * @example
 * split([{ id: "sidebar", content: leaf("folders") }, { id: "detail" }])
 * split([...], "detailOnly")   // 深链：仅 detail 列可见
 */
export function split(
    columns: readonly SplitColumnInit[],
    visibility?: SplitVisibility,
): SplitNode {
    const normalized: SplitColumn[] = columns.map((c) => ({
        id: c.id,
        content: c.content,
    }));
    return visibility === undefined
        ? { kind: NAVIGATION_NODE_KINDS.SPLIT, columns: normalized }
        : { kind: NAVIGATION_NODE_KINDS.SPLIT, columns: normalized, visibility };
}

// =====================================================================
// 类型守卫
// =====================================================================

export function isLeafNode(node: NavigationNode): node is LeafNode {
    return node.kind === NAVIGATION_NODE_KINDS.LEAF;
}

export function isStackNode(node: NavigationNode): node is StackNode {
    return node.kind === NAVIGATION_NODE_KINDS.STACK;
}

export function isTabsNode(node: NavigationNode): node is TabsNode {
    return node.kind === NAVIGATION_NODE_KINDS.TABS;
}

export function isSplitNode(node: NavigationNode): node is SplitNode {
    return node.kind === NAVIGATION_NODE_KINDS.SPLIT;
}
