/**
 * Session — 导航作用域状态（SwiftUI push/pop 生命周期的核心）
 *
 * 状态按**条目身份键** `entryKey = intent + " " + stableStringify(params)` 存入 `Map`，
 * 与 controller 的目标键同源、跨重载稳定。每次导航提交后，框架按**树中实际存在的全部条目**
 * （注意「存在」而非「可见」）prune —— 身份不在树里的条目状态被丢弃，得到 SwiftUI `@State` 语义：
 *
 *   A → push B：present `{A, B}` → A 状态保留（仍在栈、只是不可见），B 拿到自己的作用域。
 *   pop B：present `{A}` → B 的作用域被 prune 丢弃，A 原样保留；返回 A 按保留态渲染。
 *   TabView 切 tab：其它分支仍在树中 → 其状态保留（与 SwiftUI tab 保活一致）。
 *
 * `collectLeafKeys` 收集树中**全部 leaf**（含不可见的栈底、未激活分支、各 split 列），
 * 区别于 `collectVisibleDestinations`（仅沿可见路径）—— 作用域保留需要全部 present 条目。
 */

import { stableStringify } from "../prefetched-intents/stable-stringify";
import { isLeafNode, isSplitNode, isStackNode, isTabsNode } from "../navigation/nodes";
import type { NavigationNode } from "../navigation";
import type { RouteParams } from "../router/types";
import type { NavigationScopedState } from "./types";

/**
 * 导航条目身份键：`intent + " " + stableStringify(params)`。
 *
 * 与 controller 的目标键同源、跨重载稳定（`stableStringify` 对 params 键排序，
 * 故 `{a,b}` 与 `{b,a}` 产出同一键）。
 */
export function sessionEntryKey(intent: string, params: RouteParams): string {
    return `${intent} ${stableStringify(params)}`;
}

/**
 * 收集导航树中**全部 leaf** 的身份键（含不可见 / 未激活分支 / 各 split 列）。
 *
 * 递归：leaf → `[key]`；stack → flatMap(entries)；tabs → flatMap(全部 branches)；
 * split → flatMap(有内容的列)。「全部存在」而非「可见」，用于 scoped 保留。
 */
export function collectLeafKeys(tree: NavigationNode): string[] {
    if (isLeafNode(tree)) {
        return [sessionEntryKey(tree.intent, tree.params)];
    }
    if (isStackNode(tree)) {
        return tree.entries.flatMap(collectLeafKeys);
    }
    if (isTabsNode(tree)) {
        return Object.values(tree.branches).flatMap(collectLeafKeys);
    }
    if (isSplitNode(tree)) {
        return tree.columns.flatMap((column) =>
            column.content === undefined ? [] : collectLeafKeys(column.content),
        );
    }
    return [];
}

/**
 * 创建导航作用域状态容器。
 *
 * 内部持一个 `Map`；`prune` 由 `presentKeys` 构造 `Set`，删除不在其中的全部键。
 * `initial` 在构造时浅拷贝进 `Map`，构造后改动源对象不会泄漏进容器。
 */
export function createNavigationScopedState(
    initial?: Record<string, unknown>,
): NavigationScopedState {
    const store = new Map<string, unknown>(initial ? Object.entries(initial) : undefined);

    return {
        get(entryKey: string): unknown {
            return store.get(entryKey);
        },
        set(entryKey: string, data: unknown): void {
            store.set(entryKey, data);
        },
        delete(entryKey: string): void {
            store.delete(entryKey);
        },
        prune(presentKeys: Iterable<string>): void {
            const present = new Set(presentKeys);
            for (const key of store.keys()) {
                if (!present.has(key)) {
                    store.delete(key);
                }
            }
        },
        keys(): readonly string[] {
            return [...store.keys()];
        },
    };
}
