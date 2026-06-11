/**
 * Navigation — 纯函数操作（不可变 + 结构共享）
 *
 * 所有操作都不修改输入节点，返回带结构共享的新节点：仅被改动路径上的节点重建，
 * 其余子树原样复用。操作通过「目标路径」定位要变更的子树；省略 target 时默认作用于
 * 「激活路径」（root → tabs.active → stack 顶 → split 最后一个非空列 → …）。
 *
 * 非法目标（如对非 tabs 节点 selectTab、激活路径上没有 stack 却 push）会抛 NavigationError。
 */

import {
    NAVIGATION_NODE_KINDS,
    NavigationError,
    SPLIT_VISIBILITIES,
    type LeafNode,
    type NavigationNode,
    type NavigationPath,
    type NavigationPathStep,
    type SplitColumn,
    type SplitNode,
    type SplitVisibility,
    type StackNode,
    type TabsNode,
} from "./types";

// =====================================================================
// 查询：激活路径 / 定位 / 最近栈
// =====================================================================

/**
 * 解析「激活路径」：从根沿可见分支一路向下，直到叶子或无法继续。
 * - leaf：路径在此结束
 * - stack：进入栈顶 entry
 * - tabs：进入 active 分支
 * - split：进入最后一个有内容的列（无任何内容则结束）
 */
export function resolveActivePath(tree: NavigationNode): NavigationPath {
    const steps: NavigationPathStep[] = [];
    let node: NavigationNode = tree;

    for (;;) {
        switch (node.kind) {
            case NAVIGATION_NODE_KINDS.LEAF:
                return steps;
            case NAVIGATION_NODE_KINDS.STACK: {
                if (node.entries.length === 0) return steps;
                const index = node.entries.length - 1;
                steps.push({ kind: "stack-entry", index });
                node = node.entries[index];
                break;
            }
            case NAVIGATION_NODE_KINDS.TABS: {
                const branch = node.branches[node.active];
                if (branch === undefined) return steps;
                steps.push({ kind: "tab", key: node.active });
                node = branch;
                break;
            }
            case NAVIGATION_NODE_KINDS.SPLIT: {
                const last = lastNonEmptyColumn(node);
                if (last === undefined) return steps;
                steps.push({ kind: "column", id: last.id });
                node = last.content as NavigationNode;
                break;
            }
        }
    }
}

/** 找到 split 中最后一个 content 非 undefined 的列。 */
function lastNonEmptyColumn(node: SplitNode): SplitColumn | undefined {
    for (let i = node.columns.length - 1; i >= 0; i--) {
        if (node.columns[i].content !== undefined) return node.columns[i];
    }
    return undefined;
}

/**
 * 按路径定位节点；任一步无效（索引越界 / 键不存在 / 列为空 / kind 不匹配）返回 undefined。
 */
export function findNode(tree: NavigationNode, path: NavigationPath): NavigationNode | undefined {
    let node: NavigationNode | undefined = tree;
    for (const step of path) {
        if (node === undefined) return undefined;
        node = stepInto(node, step);
    }
    return node;
}

/** 沿一步路径下钻；不匹配返回 undefined。 */
function stepInto(node: NavigationNode, step: NavigationPathStep): NavigationNode | undefined {
    switch (step.kind) {
        case "stack-entry":
            if (node.kind !== NAVIGATION_NODE_KINDS.STACK) return undefined;
            return node.entries[step.index];
        case "tab":
            if (node.kind !== NAVIGATION_NODE_KINDS.TABS) return undefined;
            return node.branches[step.key];
        case "column": {
            if (node.kind !== NAVIGATION_NODE_KINDS.SPLIT) return undefined;
            const col = node.columns.find((c) => c.id === step.id);
            return col?.content;
        }
    }
}

/**
 * 找到 target 处（默认激活路径）「at/under」最近的 StackNode 路径。
 * 从 target 节点沿激活分支向下，返回第一个遇到的 StackNode 的完整路径；
 * 找不到则返回 undefined。
 */
export function findNearestStack(
    tree: NavigationNode,
    path: NavigationPath,
): NavigationPath | undefined {
    const start = findNode(tree, path);
    if (start === undefined) return undefined;

    const steps: NavigationPathStep[] = [...path];
    let node: NavigationNode = start;

    for (;;) {
        switch (node.kind) {
            case NAVIGATION_NODE_KINDS.STACK:
                return steps;
            case NAVIGATION_NODE_KINDS.LEAF:
                return undefined;
            case NAVIGATION_NODE_KINDS.TABS: {
                const branch = node.branches[node.active];
                if (branch === undefined) return undefined;
                steps.push({ kind: "tab", key: node.active });
                node = branch;
                break;
            }
            case NAVIGATION_NODE_KINDS.SPLIT: {
                const last = lastNonEmptyColumn(node);
                if (last === undefined) return undefined;
                steps.push({ kind: "column", id: last.id });
                node = last.content as NavigationNode;
                break;
            }
        }
    }
}

// =====================================================================
// 可见目标收集
// =====================================================================

/**
 * 收集所有可见的叶子目标（顺序即渲染/解析顺序）。
 * - leaf → [leaf]
 * - stack → 栈顶 entry 的可见目标
 * - tabs → active 分支的可见目标
 * - split → 每个有内容的列的可见目标，按列序拼接
 */
export function collectVisibleDestinations(tree: NavigationNode): readonly LeafNode[] {
    const out: LeafNode[] = [];
    collectInto(tree, out);
    return out;
}

function collectInto(node: NavigationNode, out: LeafNode[]): void {
    switch (node.kind) {
        case NAVIGATION_NODE_KINDS.LEAF:
            out.push(node);
            return;
        case NAVIGATION_NODE_KINDS.STACK: {
            if (node.entries.length === 0) return;
            collectInto(node.entries[node.entries.length - 1], out);
            return;
        }
        case NAVIGATION_NODE_KINDS.TABS: {
            const branch = node.branches[node.active];
            if (branch !== undefined) collectInto(branch, out);
            return;
        }
        case NAVIGATION_NODE_KINDS.SPLIT: {
            for (const col of visibleSplitColumns(node)) {
                if (col.content !== undefined) collectInto(col.content, out);
            }
            return;
        }
    }
}

/**
 * 收集树中**全部存在**的叶子（含不可见：栈非顶 entry、未激活 tab 分支、所有非空 split 列）。
 * 区别于 `collectVisibleDestinations`（只沿可见分支）—— 保活 / 缓存 prune / 作用域保留需要
 * 全部 present 条目。顺序：栈按序、tabs 按 `Object.values(branches)` 序、split 按列序。
 */
export function collectAllLeaves(tree: NavigationNode): readonly LeafNode[] {
    const out: LeafNode[] = [];
    collectAllInto(tree, out);
    return out;
}

function collectAllInto(node: NavigationNode, out: LeafNode[]): void {
    switch (node.kind) {
        case NAVIGATION_NODE_KINDS.LEAF:
            out.push(node);
            return;
        case NAVIGATION_NODE_KINDS.STACK:
            for (const entry of node.entries) collectAllInto(entry, out);
            return;
        case NAVIGATION_NODE_KINDS.TABS:
            for (const branch of Object.values(node.branches)) collectAllInto(branch, out);
            return;
        case NAVIGATION_NODE_KINDS.SPLIT:
            for (const col of node.columns) {
                if (col.content !== undefined) collectAllInto(col.content, out);
            }
            return;
    }
}

/**
 * 按 `visibility` 求出一个 split 节点当前**可见**的列（不裁剪空内容列——空 content 由调用方处理）。
 *
 * - `automatic`（缺省）/ `all`：全部列。
 * - `doubleColumn`：首列 + 末列（三列时隐藏中间 content 列；列数 ≤ 2 时等价全部）。
 * - `detailOnly`：仅末列（detail）。
 *
 * 应用渲染时也可用它决定该画哪几列，无需自行重实现可见性映射。
 */
export function visibleSplitColumns(node: SplitNode): readonly SplitColumn[] {
    const { columns, visibility } = node;
    if (columns.length === 0) return columns;
    switch (visibility) {
        case SPLIT_VISIBILITIES.DETAIL_ONLY:
            return [columns[columns.length - 1]];
        case SPLIT_VISIBILITIES.DOUBLE_COLUMN: {
            const last = columns.length - 1;
            return last === 0 ? [columns[0]] : [columns[0], columns[last]];
        }
        // automatic / all / undefined：不裁剪。
        default:
            return columns;
    }
}

// =====================================================================
// 路径变换内核：在 path 处用 mapper 重建节点（结构共享）
// =====================================================================

/**
 * 在 `path` 指向的节点上应用 `mapper`，返回重建后的根（仅路径上的节点重建）。
 * 任一步无效抛 NavigationError。
 */
function transformAt(
    tree: NavigationNode,
    path: NavigationPath,
    mapper: (node: NavigationNode) => NavigationNode,
): NavigationNode {
    if (path.length === 0) return mapper(tree);
    return rebuild(tree, path, 0, mapper);
}

function rebuild(
    node: NavigationNode,
    path: NavigationPath,
    depth: number,
    mapper: (node: NavigationNode) => NavigationNode,
): NavigationNode {
    if (depth === path.length) return mapper(node);
    const step = path[depth];

    switch (step.kind) {
        case "stack-entry": {
            if (node.kind !== NAVIGATION_NODE_KINDS.STACK) {
                throw new NavigationError(
                    `路径无效：在 ${node.kind} 节点上期望 stack（stack-entry 步）`,
                );
            }
            if (step.index < 0 || step.index >= node.entries.length) {
                throw new NavigationError(`路径无效：stack entry 索引越界 ${step.index}`);
            }
            const entries = node.entries.slice();
            entries[step.index] = rebuild(entries[step.index], path, depth + 1, mapper);
            return { ...node, entries };
        }
        case "tab": {
            if (node.kind !== NAVIGATION_NODE_KINDS.TABS) {
                throw new NavigationError(`路径无效：在 ${node.kind} 节点上期望 tabs（tab 步）`);
            }
            const branch = node.branches[step.key];
            if (branch === undefined) {
                throw new NavigationError(`路径无效：tabs 分支 "${step.key}" 不存在`);
            }
            return {
                ...node,
                branches: {
                    ...node.branches,
                    [step.key]: rebuild(branch, path, depth + 1, mapper),
                },
            };
        }
        case "column": {
            if (node.kind !== NAVIGATION_NODE_KINDS.SPLIT) {
                throw new NavigationError(
                    `路径无效：在 ${node.kind} 节点上期望 split（column 步）`,
                );
            }
            const idx = node.columns.findIndex((c) => c.id === step.id);
            if (idx === -1) {
                throw new NavigationError(`路径无效：split 列 "${step.id}" 不存在`);
            }
            const content = node.columns[idx].content;
            if (content === undefined) {
                throw new NavigationError(`路径无效：split 列 "${step.id}" 内容为空`);
            }
            const columns = node.columns.slice();
            columns[idx] = { ...columns[idx], content: rebuild(content, path, depth + 1, mapper) };
            return { ...node, columns };
        }
    }
}

/**
 * 沿激活路径（root → 可见叶子）下行，返回「最深」（top 当前可见）的 stack 路径。
 * 这是栈操作（push/pop/…）在未显式给 target 时的默认作用栈。
 * 激活路径上没有任何 stack 则返回 undefined。
 */
function findActiveStack(tree: NavigationNode): NavigationPath | undefined {
    const steps: NavigationPathStep[] = [];
    let deepest: NavigationPath | undefined;
    let node: NavigationNode = tree;

    for (;;) {
        if (node.kind === NAVIGATION_NODE_KINDS.STACK) deepest = [...steps];
        switch (node.kind) {
            case NAVIGATION_NODE_KINDS.LEAF:
                return deepest;
            case NAVIGATION_NODE_KINDS.STACK: {
                if (node.entries.length === 0) return deepest;
                const index = node.entries.length - 1;
                steps.push({ kind: "stack-entry", index });
                node = node.entries[index];
                break;
            }
            case NAVIGATION_NODE_KINDS.TABS: {
                const branch = node.branches[node.active];
                if (branch === undefined) return deepest;
                steps.push({ kind: "tab", key: node.active });
                node = branch;
                break;
            }
            case NAVIGATION_NODE_KINDS.SPLIT: {
                const last = lastNonEmptyColumn(node);
                if (last === undefined) return deepest;
                steps.push({ kind: "column", id: last.id });
                node = last.content as NavigationNode;
                break;
            }
        }
    }
}

/**
 * 解析栈操作的目标栈路径：
 * - 显式 target → 取 target「at/under」最近的 stack（findNearestStack 向下钻）；
 * - 缺省 → 取激活路径上最深的 stack（findActiveStack）。
 */
function resolveStackTarget(
    tree: NavigationNode,
    target?: NavigationPath,
): NavigationPath | undefined {
    return target ? findNearestStack(tree, target) : findActiveStack(tree);
}

// =====================================================================
// 栈操作：push / pop / popToRoot / popTo / replaceTop
// =====================================================================

/** 在目标栈（默认激活栈，或 target「at/under」最近的 stack）顶部 push 一个节点。 */
export function push(
    tree: NavigationNode,
    node: NavigationNode,
    target?: NavigationPath,
): NavigationNode {
    const stackPath = resolveStackTarget(tree, target);
    if (stackPath === undefined) {
        throw new NavigationError("push 失败：激活路径上没有可用的 stack");
    }
    return transformAt(tree, stackPath, (s) => {
        const st = s as StackNode;
        return { ...st, entries: [...st.entries, node] };
    });
}

/** 从 target 处最近的 stack 弹出 count 个 entry（默认 1）；绝不弹到根 entry 之下。 */
export function pop(tree: NavigationNode, count = 1, target?: NavigationPath): NavigationNode {
    if (count <= 0) return tree;
    const stackPath = resolveStackTarget(tree, target);
    if (stackPath === undefined) {
        throw new NavigationError("pop 失败：激活路径上没有可用的 stack");
    }
    return transformAt(tree, stackPath, (s) => {
        const st = s as StackNode;
        // 保留至少根 entry；最多弹 entries.length - 1 个。
        const keep = Math.max(1, st.entries.length - count);
        if (keep === st.entries.length) return st;
        return { ...st, entries: st.entries.slice(0, keep) };
    });
}

/** 把 target 处最近的 stack 弹回到根 entry。 */
export function popToRoot(tree: NavigationNode, target?: NavigationPath): NavigationNode {
    const stackPath = resolveStackTarget(tree, target);
    if (stackPath === undefined) {
        throw new NavigationError("popToRoot 失败：激活路径上没有可用的 stack");
    }
    return transformAt(tree, stackPath, (s) => {
        const st = s as StackNode;
        if (st.entries.length <= 1) return st;
        return { ...st, entries: st.entries.slice(0, 1) };
    });
}

/** 把 target 处最近的 stack 弹回到指定 index（保留 [0..index]）。 */
export function popTo(
    tree: NavigationNode,
    index: number,
    target?: NavigationPath,
): NavigationNode {
    const stackPath = resolveStackTarget(tree, target);
    if (stackPath === undefined) {
        throw new NavigationError("popTo 失败：激活路径上没有可用的 stack");
    }
    return transformAt(tree, stackPath, (s) => {
        const st = s as StackNode;
        if (index < 0 || index >= st.entries.length) {
            throw new NavigationError(
                `popTo 失败：index ${index} 越界（栈深 ${st.entries.length}）`,
            );
        }
        if (index === st.entries.length - 1) return st;
        return { ...st, entries: st.entries.slice(0, index + 1) };
    });
}

/** 替换 target 处最近 stack 的栈顶 entry（栈为空时抛错）。 */
export function replaceTop(
    tree: NavigationNode,
    node: NavigationNode,
    target?: NavigationPath,
): NavigationNode {
    const stackPath = resolveStackTarget(tree, target);
    if (stackPath === undefined) {
        throw new NavigationError("replaceTop 失败：激活路径上没有可用的 stack");
    }
    return transformAt(tree, stackPath, (s) => {
        const st = s as StackNode;
        if (st.entries.length === 0) {
            throw new NavigationError("replaceTop 失败：stack 为空");
        }
        const entries = st.entries.slice();
        entries[entries.length - 1] = node;
        return { ...st, entries };
    });
}

// =====================================================================
// Tabs / Split 操作
// =====================================================================

/**
 * 切换 tabs 节点的激活分支。
 * target 默认为「最近的激活 tabs 节点」；target 必须指向 TabsNode，且 key 必须是已知分支。
 */
export function selectTab(
    tree: NavigationNode,
    key: string,
    target?: NavigationPath,
): NavigationNode {
    const tabsPath = target ?? findActiveKind(tree, NAVIGATION_NODE_KINDS.TABS);
    if (tabsPath === undefined) {
        throw new NavigationError("selectTab 失败：激活路径上没有 tabs 节点");
    }
    return transformAt(tree, tabsPath, (n) => {
        if (n.kind !== NAVIGATION_NODE_KINDS.TABS) {
            throw new NavigationError(`selectTab 失败：目标是 ${n.kind} 节点，不是 tabs`);
        }
        const t = n as TabsNode;
        if (!(key in t.branches)) {
            throw new NavigationError(`selectTab 失败：未知分支 "${key}"`);
        }
        if (t.active === key) return t;
        return { ...t, active: key };
    });
}

/**
 * 设置 split 某列内容，并清空它之后的所有列（content 置 undefined）。
 * target 默认为「最近的激活 split 节点」；columnId 必须是已知列。
 */
export function selectColumn(
    tree: NavigationNode,
    columnId: string,
    content: NavigationNode | undefined,
    target?: NavigationPath,
): NavigationNode {
    const splitPath = target ?? findActiveKind(tree, NAVIGATION_NODE_KINDS.SPLIT);
    if (splitPath === undefined) {
        throw new NavigationError("selectColumn 失败：激活路径上没有 split 节点");
    }
    return transformAt(tree, splitPath, (n) => {
        if (n.kind !== NAVIGATION_NODE_KINDS.SPLIT) {
            throw new NavigationError(`selectColumn 失败：目标是 ${n.kind} 节点，不是 split`);
        }
        const sp = n as SplitNode;
        const idx = sp.columns.findIndex((c) => c.id === columnId);
        if (idx === -1) {
            throw new NavigationError(`selectColumn 失败：未知列 "${columnId}"`);
        }
        const columns: SplitColumn[] = sp.columns.map((c, i) => {
            if (i === idx) return { ...c, content };
            if (i > idx) return { ...c, content: undefined };
            return c;
        });
        return { ...sp, columns };
    });
}

/**
 * 设置 split 节点的列可见性（对标 SwiftUI `NavigationSplitViewVisibility`）。
 * target 默认为「最近的激活 split 节点」。改变 visibility 会影响 `collectVisibleDestinations`，
 * 进而触发 controller 对「新变可见」的列做 dispatch / SSR 预取（如 detailOnly → all 时补预取 sidebar/content）。
 */
export function setVisibility(
    tree: NavigationNode,
    visibility: SplitVisibility,
    target?: NavigationPath,
): NavigationNode {
    const splitPath = target ?? findActiveKind(tree, NAVIGATION_NODE_KINDS.SPLIT);
    if (splitPath === undefined) {
        throw new NavigationError("setVisibility 失败：激活路径上没有 split 节点");
    }
    return transformAt(tree, splitPath, (n) => {
        if (n.kind !== NAVIGATION_NODE_KINDS.SPLIT) {
            throw new NavigationError(`setVisibility 失败：目标是 ${n.kind} 节点，不是 split`);
        }
        return { ...(n as SplitNode), visibility };
    });
}

/**
 * 沿激活路径（root → 可见叶子）下行，返回 kind 匹配的「最外层」（最接近根）节点路径。
 * 这是 `selectTab`/`selectColumn` 的默认目标：无 target 时操作最顶层的 tabs/split
 * （主标签栏 / 主分栏）；需要更深的容器由调用方显式传 target。
 * 整条激活路径上都没有匹配则返回 undefined。
 */
function findActiveKind(
    tree: NavigationNode,
    kind: TabsNode["kind"] | SplitNode["kind"],
): NavigationPath | undefined {
    const steps: NavigationPathStep[] = [];
    let node: NavigationNode = tree;

    for (;;) {
        if (node.kind === kind) return steps;
        switch (node.kind) {
            case NAVIGATION_NODE_KINDS.LEAF:
                return undefined;
            case NAVIGATION_NODE_KINDS.STACK: {
                if (node.entries.length === 0) return undefined;
                const index = node.entries.length - 1;
                steps.push({ kind: "stack-entry", index });
                node = node.entries[index];
                break;
            }
            case NAVIGATION_NODE_KINDS.TABS: {
                const branch = node.branches[node.active];
                if (branch === undefined) return undefined;
                steps.push({ kind: "tab", key: node.active });
                node = branch;
                break;
            }
            case NAVIGATION_NODE_KINDS.SPLIT: {
                const last = lastNonEmptyColumn(node);
                if (last === undefined) return undefined;
                steps.push({ kind: "column", id: last.id });
                node = last.content as NavigationNode;
                break;
            }
        }
    }
}
