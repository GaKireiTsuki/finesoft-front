/**
 * Navigation — 序列化 / 反序列化
 *
 * `serializeNavigation` 把导航树转成 JSON 安全的纯对象（SerializedNavigation），
 * `deserializeNavigation` 反向还原并校验结构，畸形数据抛 NavigationError。
 * 往返必须无损（含 split 空列 `content: undefined`、params 任意 JSON 值）。
 *
 * 复用 `stableStringify` 提供 `serializeNavigationStable` —— 给需要稳定字符串/键的
 * 场景（如 codec 的紧凑稳定编码、缓存键）一个确定性输出。
 */

import { stableStringify } from "../prefetched-intents/stable-stringify";
import type { RouteParams } from "../router/types";
import {
    NAVIGATION_NODE_KINDS,
    NavigationError,
    SPLIT_VISIBILITIES,
    type NavigationNode,
    type NavigationNodeKind,
    type SplitVisibility,
} from "./types";

/** 合法的 split 可见性取值集合（反序列化校验用） */
const SPLIT_VISIBILITY_VALUES = new Set<string>(Object.values(SPLIT_VISIBILITIES));

// =====================================================================
// 序列化形态（JSON 安全）
// =====================================================================

/** 序列化叶子 */
export interface SerializedLeaf {
    readonly kind: typeof NAVIGATION_NODE_KINDS.LEAF;
    readonly intent: string;
    readonly params: RouteParams;
}

/** 序列化栈 */
export interface SerializedStack {
    readonly kind: typeof NAVIGATION_NODE_KINDS.STACK;
    readonly entries: readonly SerializedNavigation[];
}

/** 序列化 Tabs */
export interface SerializedTabs {
    readonly kind: typeof NAVIGATION_NODE_KINDS.TABS;
    readonly active: string;
    readonly order: readonly string[];
    readonly branches: Readonly<Record<string, SerializedNavigation>>;
}

/** 序列化 Split 列（空内容用 null 表示，JSON 安全） */
export interface SerializedSplitColumn {
    readonly id: string;
    readonly content: SerializedNavigation | null;
}

/** 序列化 Split（visibility 缺省时不写该字段，保持紧凑） */
export interface SerializedSplit {
    readonly kind: typeof NAVIGATION_NODE_KINDS.SPLIT;
    readonly columns: readonly SerializedSplitColumn[];
    readonly visibility?: SplitVisibility;
}

/** 序列化后的导航树（JSON 安全的可辨识联合） */
export type SerializedNavigation =
    | SerializedLeaf
    | SerializedStack
    | SerializedTabs
    | SerializedSplit;

// =====================================================================
// 序列化
// =====================================================================

/** 把导航树序列化为 JSON 安全的纯对象。 */
export function serializeNavigation(tree: NavigationNode): SerializedNavigation {
    switch (tree.kind) {
        case NAVIGATION_NODE_KINDS.LEAF:
            return { kind: NAVIGATION_NODE_KINDS.LEAF, intent: tree.intent, params: tree.params };
        case NAVIGATION_NODE_KINDS.STACK:
            return {
                kind: NAVIGATION_NODE_KINDS.STACK,
                entries: tree.entries.map(serializeNavigation),
            };
        case NAVIGATION_NODE_KINDS.TABS: {
            const branches: Record<string, SerializedNavigation> = {};
            for (const key of Object.keys(tree.branches)) {
                branches[key] = serializeNavigation(tree.branches[key]);
            }
            return {
                kind: NAVIGATION_NODE_KINDS.TABS,
                active: tree.active,
                order: [...tree.order],
                branches,
            };
        }
        case NAVIGATION_NODE_KINDS.SPLIT: {
            const columns = tree.columns.map((c) => ({
                id: c.id,
                content: c.content === undefined ? null : serializeNavigation(c.content),
            }));
            return tree.visibility === undefined
                ? { kind: NAVIGATION_NODE_KINDS.SPLIT, columns }
                : { kind: NAVIGATION_NODE_KINDS.SPLIT, columns, visibility: tree.visibility };
        }
    }
}

/** 导航树的确定性字符串形式（keys 排序）；用于稳定缓存键 / 紧凑编码。 */
export function serializeNavigationStable(tree: NavigationNode): string {
    return stableStringify(serializeNavigation(tree));
}

// =====================================================================
// 反序列化（结构校验）
// =====================================================================

const KNOWN_KINDS = new Set<NavigationNodeKind>([
    NAVIGATION_NODE_KINDS.LEAF,
    NAVIGATION_NODE_KINDS.STACK,
    NAVIGATION_NODE_KINDS.TABS,
    NAVIGATION_NODE_KINDS.SPLIT,
]);

/** 从 JSON 安全数据还原导航树；结构畸形抛 NavigationError。 */
export function deserializeNavigation(data: unknown): NavigationNode {
    return parseNode(data, "$");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseNode(data: unknown, path: string): NavigationNode {
    if (!isPlainObject(data)) {
        throw new NavigationError(`反序列化失败：${path} 不是对象`);
    }
    const kind = data.kind;
    if (typeof kind !== "string" || !KNOWN_KINDS.has(kind as NavigationNodeKind)) {
        throw new NavigationError(`反序列化失败：${path}.kind 非法（${String(kind)}）`);
    }

    switch (kind as NavigationNodeKind) {
        case NAVIGATION_NODE_KINDS.LEAF:
            return parseLeaf(data, path);
        case NAVIGATION_NODE_KINDS.STACK:
            return parseStack(data, path);
        case NAVIGATION_NODE_KINDS.TABS:
            return parseTabs(data, path);
        case NAVIGATION_NODE_KINDS.SPLIT:
            return parseSplit(data, path);
    }
}

function parseLeaf(data: Record<string, unknown>, path: string): NavigationNode {
    if (typeof data.intent !== "string") {
        throw new NavigationError(`反序列化失败：${path}.intent 必须是字符串`);
    }
    if (!isPlainObject(data.params)) {
        throw new NavigationError(`反序列化失败：${path}.params 必须是对象`);
    }
    return {
        kind: NAVIGATION_NODE_KINDS.LEAF,
        intent: data.intent,
        params: { ...data.params },
    };
}

function parseStack(data: Record<string, unknown>, path: string): NavigationNode {
    if (!Array.isArray(data.entries)) {
        throw new NavigationError(`反序列化失败：${path}.entries 必须是数组`);
    }
    return {
        kind: NAVIGATION_NODE_KINDS.STACK,
        entries: data.entries.map((e, i) => parseNode(e, `${path}.entries[${i}]`)),
    };
}

function parseTabs(data: Record<string, unknown>, path: string): NavigationNode {
    if (typeof data.active !== "string") {
        throw new NavigationError(`反序列化失败：${path}.active 必须是字符串`);
    }
    if (!Array.isArray(data.order) || !data.order.every((k) => typeof k === "string")) {
        throw new NavigationError(`反序列化失败：${path}.order 必须是字符串数组`);
    }
    if (!isPlainObject(data.branches)) {
        throw new NavigationError(`反序列化失败：${path}.branches 必须是对象`);
    }
    const branches: Record<string, NavigationNode> = {};
    for (const key of Object.keys(data.branches)) {
        branches[key] = parseNode(data.branches[key], `${path}.branches.${key}`);
    }
    // order 不得含 branches 之外的「幽灵键」：否则 app 按 order 渲染 tab 栏时
    // branches[key] === undefined，导致空白 tab 或崩溃。逐键校验。
    for (const key of data.order as readonly string[]) {
        if (!(key in branches)) {
            throw new NavigationError(
                `反序列化失败：${path}.order 包含不在 branches 中的键 "${key}"`,
            );
        }
    }
    if (!(data.active in branches)) {
        throw new NavigationError(`反序列化失败：${path}.active "${data.active}" 不在 branches 中`);
    }
    return {
        kind: NAVIGATION_NODE_KINDS.TABS,
        active: data.active,
        order: [...(data.order as string[])],
        branches,
    };
}

function parseSplit(data: Record<string, unknown>, path: string): NavigationNode {
    if (!Array.isArray(data.columns)) {
        throw new NavigationError(`反序列化失败：${path}.columns 必须是数组`);
    }
    const columns = data.columns.map((col, i) => {
        const colPath = `${path}.columns[${i}]`;
        if (!isPlainObject(col)) {
            throw new NavigationError(`反序列化失败：${colPath} 不是对象`);
        }
        if (typeof col.id !== "string") {
            throw new NavigationError(`反序列化失败：${colPath}.id 必须是字符串`);
        }
        const content =
            col.content === null || col.content === undefined
                ? undefined
                : parseNode(col.content, `${colPath}.content`);
        return { id: col.id, content };
    });
    if (data.visibility === undefined) {
        return { kind: NAVIGATION_NODE_KINDS.SPLIT, columns };
    }
    if (typeof data.visibility !== "string" || !SPLIT_VISIBILITY_VALUES.has(data.visibility)) {
        throw new NavigationError(
            `反序列化失败：${path}.visibility 非法值 ${JSON.stringify(data.visibility)}`,
        );
    }
    return {
        kind: NAVIGATION_NODE_KINDS.SPLIT,
        columns,
        visibility: data.visibility as SplitVisibility,
    };
}
