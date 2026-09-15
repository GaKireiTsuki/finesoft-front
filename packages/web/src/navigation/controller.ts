/**
 * NavigationController — 导航控制器
 *
 * 把纯导航树（operations）接到框架的「请求生命周期」上：对标 SSR `ssrRenderInternal`
 * 与浏览器 `navigateTo`，按 **每个可见目标** 复刻同一套 resolve → beforeLoad →
 * dispatch → afterLoad → commit 序列；但导航层对内容无关，`Page` 字段语义由应用决定。
 *
 * 控制器本身不持有 UI、不碰 history/URL（那是 browser-bridge / ssr 的活），只负责：
 * 用 operations 算出下一棵树（纯、结构共享）→ 解析所有可见目标（复用未变页 + 预取缓存）
 * → 跑主目标的 before/after 守卫 → 提交快照 → 通知订阅者。
 *
 * 与现有扁平 runner 的语义对齐点（务必一致）：
 * - **beforeLoad rewrite**：当作「换 URL 重路由」——对主目标用新 URL 重新 resolve 出 leaf
 *   并替换该目标的 intent/params（等价 `navigateTo` 的 rewrite≈redirect）。
 * - **beforeLoad redirect**：交给应用提供的 `onRedirect`（SPA 内跳 / 外链）；本目标不 dispatch。
 * - **beforeLoad deny**：给该目标打上 deny status，**不** dispatch 它的 intent。
 * - **afterLoad rewrite**：数据已加载，仅记 canonical URL（不重跑），page 保留。
 * - **afterLoad redirect/deny**：与 before 对称（redirect 触发 onRedirect；deny 记 status）。
 * - **dispatch 失败**：复刻 controller 的 fallback 语义——不把单个目标的失败抛出 `apply`，
 *   而是把失败记录在该目标上（status + 来自 `getErrorPage` 的兜底页）。
 *
 * 单个 LeafNode 树 = 今天的扁平单页：一个可见目标、一次 resolve/dispatch、一对 before/after。
 */

import { ExecutionError, generateUuid, type ExecutionHandle, type Container } from "@finesoft/core";
import { Framework } from "../framework";
import { loadPage } from "../application/load-page";
import type { AfterLoadGuard, BeforeLoadGuard, NavigationContext } from "../middleware/types";
import { bindExecutionCancellation } from "../application/execution";
import { resourceKey } from "./keys";
import type { RouteParams } from "../router/types";
import { leaf } from "./nodes";
import {
    collectAllLeaves,
    collectVisibleDestinations,
    findNode,
    pop,
    popTo,
    popToRoot,
    push,
    replaceTop,
    reuseEntry,
    mapNavigationLeaves,
    resolveActivePath,
    selectColumn,
    selectTab,
    setVisibility,
} from "./operations";
import type {
    LeafNode,
    NavigationNode,
    NavigationPath,
    NavigationSnapshot,
    Page,
    ResolvedDestination,
    SplitVisibility,
} from "./types";

// =====================================================================
// NavigationOperation — 声明式操作（可辨识联合）
// =====================================================================

/** 导航操作 Kind 常量 */
export const NAVIGATION_OP_KINDS = {
    PUSH: "push",
    POP: "pop",
    POP_TO_ROOT: "popToRoot",
    POP_TO: "popTo",
    REPLACE_TOP: "replaceTop",
    SELECT_TAB: "selectTab",
    SELECT_COLUMN: "selectColumn",
    SET_VISIBILITY: "setVisibility",
    HYDRATE: "hydrate",
    REUSE_ENTRY: "reuseEntry",
} as const;

/** 所有导航操作 Kind 的联合类型 */
export type NavigationOpKind = (typeof NAVIGATION_OP_KINDS)[keyof typeof NAVIGATION_OP_KINDS];

/** push：在目标栈顶压入一个新 leaf（intent + params）。 */
export interface PushOperation {
    readonly kind: typeof NAVIGATION_OP_KINDS.PUSH;
    readonly intent: string;
    readonly params?: RouteParams;
    readonly target?: NavigationPath;
    readonly url?: string;
}

/** pop：从目标栈弹出 count 个 entry（默认 1）。 */
export interface PopOperation {
    readonly kind: typeof NAVIGATION_OP_KINDS.POP;
    readonly count?: number;
    readonly target?: NavigationPath;
}

/** popToRoot：把目标栈弹回根 entry。 */
export interface PopToRootOperation {
    readonly kind: typeof NAVIGATION_OP_KINDS.POP_TO_ROOT;
    readonly target?: NavigationPath;
}

/** popTo：把目标栈弹回指定 index。 */
export interface PopToOperation {
    readonly kind: typeof NAVIGATION_OP_KINDS.POP_TO;
    readonly index: number;
    readonly target?: NavigationPath;
}

/** replaceTop：替换目标栈的栈顶为新 leaf。 */
export interface ReplaceTopOperation {
    readonly url?: string;
    readonly kind: typeof NAVIGATION_OP_KINDS.REPLACE_TOP;
    readonly intent: string;
    readonly params?: RouteParams;
    readonly target?: NavigationPath;
}

/** selectTab：切换 tabs 节点的激活分支。 */
export interface SelectTabOperation {
    readonly kind: typeof NAVIGATION_OP_KINDS.SELECT_TAB;
    readonly key: string;
    readonly target?: NavigationPath;
}

/** selectColumn：设置 split 某列内容（intent 为 undefined 表示清空该列）。 */
export interface SelectColumnOperation {
    readonly kind: typeof NAVIGATION_OP_KINDS.SELECT_COLUMN;
    readonly columnId: string;
    readonly intent: string | undefined;
    readonly params?: RouteParams;
    readonly target?: NavigationPath;
}

/** setVisibility：设置 split 节点的列可见性（对标 NavigationSplitViewVisibility）。 */
export interface SetVisibilityOperation {
    readonly kind: typeof NAVIGATION_OP_KINDS.SET_VISIBILITY;
    readonly visibility: SplitVisibility;
    readonly target?: NavigationPath;
}

/** hydrate：用外部给定的整棵树替换当前树（来自 history/URL 还原）。 */
export interface HydrateOperation {
    readonly kind: typeof NAVIGATION_OP_KINDS.HYDRATE;
    readonly tree: NavigationNode;
}

/** 所有导航操作的可辨识联合。 */
export type NavigationOperation =
    | { readonly kind: "reuseEntry"; readonly entryId: string }
    | PushOperation
    | PopOperation
    | PopToRootOperation
    | PopToOperation
    | ReplaceTopOperation
    | SelectTabOperation
    | SelectColumnOperation
    | SetVisibilityOperation
    | HydrateOperation;

// =====================================================================
// 上下文构建回调
// =====================================================================

/**
 * 控制器解析单个目标时需要的「环境」——由应用提供。
 *
 * 仓库里没有契约所说的 `IntentContext`：dispatch 需要 `Container`，守卫需要
 * `NavigationContext`（含 url/cookie/header）。所以 `createContext` 在此被建模为
 * 「给定目标 intent/params，返回构建守卫上下文 + 派发所需的零件」：
 * - `container`：派发 intent 用（`intentDispatcher.dispatch(intent, container)`）。
 * - `navigation`：完整的 `NavigationContext`（应用按 SSR/CSR 用
 *   `createServerContext`/`createBrowserContext` 造好传入）；缺省时控制器用一个不含
 *   cookie/header 的最小上下文兜底（含 url/path/params/intent/container/isServer，
 *   其中 isServer 取 `NavigationControllerOptions.isServer`，缺省按运行环境推断）。
 *
 * `signal` 暂无消费方（现有 runner 也没有 AbortSignal 管线），仅透传保留。
 */
export interface NavigationContextInput {
    readonly intent: string;
    readonly params: RouteParams;
    readonly signal?: AbortSignal;
    readonly url?: string;
}

/** `createContext` 的返回：派发用的 Container + 守卫用的 NavigationContext（可选）。 */
export interface NavigationDispatchContext {
    /** DI 容器 —— intent 派发的必备参数。 */
    readonly container: Container;
    /** 守卫上下文；缺省时控制器用最小上下文兜底。 */
    readonly navigation?: NavigationContext;
    /** 该目标对应的完整 URL（用于最小兜底上下文的 url/path）。 */
    readonly url?: string;
}

// =====================================================================
// NavigationControllerOptions / NavigationController
// =====================================================================

/** NavigationController 构造选项。 */
export interface NavigationControllerOptions {
    readonly framework: Framework;
    readonly execution?: ExecutionHandle;
    readonly viewReady?: (snapshot: NavigationSnapshot) => void | Promise<void>;
    /** 初始导航树（单 LeafNode = 今天的扁平单页）。 */
    readonly initial: NavigationNode;
    /** 应用提供的「目标 → 派发上下文」构建回调。 */
    readonly createContext?: (input: NavigationContextInput) => NavigationDispatchContext;
    /**
     * 是否运行在服务端——仅用于 `createContext` 未返回 `navigation` 时的最小兜底上下文，
     * 决定该上下文的 `isServer` 字段。缺省为 true；浏览器 host 显式传 false。
     * 应用若已通过 `createContext` 提供完整 `navigation`，此项不生效。
     */
    readonly isServer?: boolean;
    /** 目标级 beforeLoad 守卫（在全局/路由守卫之外，由控制器对每个可见目标执行）。 */
    readonly beforeLoad?: readonly BeforeLoadGuard[];
    /** 目标级 afterLoad 守卫。 */
    readonly afterLoad?: readonly AfterLoadGuard[];
    /**
     * 兜底错误页工厂——dispatch 失败 / deny 时，用它产出该目标的 page。
     * 缺省用一个最小的 BasePage（pageType="error"）。复刻 runner 的 fallback 语义。
     */
    readonly getErrorPage?: (status: number, message: string) => Page;
    /**
     * redirect 处理器——beforeLoad/afterLoad 返回 redirect 时调用（SPA 内跳 / 外链）。
     * 控制器不持有 history，把「怎么跳」交给应用（浏览器侧 → `framework.perform`）。
     * 缺省为 no-op（该目标不 dispatch、不再跳，仅保留当前页/兜底页）。
     */
    readonly onRedirect?: (redirect: { url: string; status: number }) => void;
}

/** 导航控制器对外接口。 */
export interface NavigationController {
    /** 当前导航树。 */
    getTree(): NavigationNode;
    /** 当前快照（树 + 已解析的可见目标）。 */
    getSnapshot(): NavigationSnapshot;
    /** 应用一个声明式操作，重解析并提交，返回新快照。 */
    apply(op: NavigationOperation, options?: { signal?: AbortSignal }): Promise<NavigationSnapshot>;
    cancel(): void;
    dispose(): Promise<void>;
    reuseEntry(entryId: string): Promise<NavigationSnapshot>;
    /** 便捷：在激活栈压入新目标。 */
    push(intent: string, params?: RouteParams, options?: PushOptions): Promise<NavigationSnapshot>;
    /** 便捷：从激活栈弹出。 */
    pop(count?: number): Promise<NavigationSnapshot>;
    /** 便捷：激活栈弹回根。 */
    popToRoot(): Promise<NavigationSnapshot>;
    /** 便捷：替换激活栈栈顶。 */
    replaceTop(intent: string, params?: RouteParams): Promise<NavigationSnapshot>;
    /** 便捷：切换 tabs 激活分支。 */
    selectTab(key: string, target?: NavigationPath): Promise<NavigationSnapshot>;
    /** 便捷：设置 split 列内容（intent=undefined 清空）。 */
    selectColumn(
        columnId: string,
        intent: string | undefined,
        params?: RouteParams,
        target?: NavigationPath,
    ): Promise<NavigationSnapshot>;
    /** 便捷：设置 split 列可见性（对标 NavigationSplitViewVisibility）；改变可见集会触发新可见列的派发。 */
    setVisibility(
        visibility: SplitVisibility,
        target?: NavigationPath,
    ): Promise<NavigationSnapshot>;
    /** 用外部树替换当前树并重解析（history/URL 还原）。 */
    hydrate(tree: NavigationNode): Promise<NavigationSnapshot>;
    /**
     * 清除页面缓存：给 `entryId` 清单个，
     * 不传清全部。仅清缓存、不触发重解析——该条目下次被解析时重新 dispatch。
     */
    invalidate(entryKey?: string): void;
    /** 清当前激活叶子的缓存并重解析当前树（「下拉刷新」式：守卫跑、数据重 fetch）。 */
    refresh(): Promise<NavigationSnapshot>;
    /** 订阅快照变更；返回取消订阅函数。 */
    subscribe(listener: (snapshot: NavigationSnapshot) => void): () => void;
    /** 解析当前树（首屏 SSR/CSR），提交并返回快照。 */
    resolve(): Promise<NavigationSnapshot>;
}

/** `push` 便捷方法的可选项。 */
export interface PushOptions {
    readonly url?: string;
    readonly target?: NavigationPath;
}

// =====================================================================
// 实现
// =====================================================================

function defaultErrorPage(status: number, message: string): Page {
    return { id: `error-${status}`, pageType: "error", title: message };
}

export function createNavigationController(
    options: NavigationControllerOptions,
): NavigationController {
    const framework = options.framework;
    const getErrorPage =
        options.getErrorPage ?? framework.definition?.getErrorPage ?? defaultErrorPage;
    let tree = options.initial;
    let snapshot: NavigationSnapshot = { tree, destinations: [] };
    const listeners = new Set<(snapshot: NavigationSnapshot) => void>();
    const pageCache = new Map<string, ResolvedDestination>();
    let inflight: Promise<unknown> = Promise.resolve();
    let current: AbortController | undefined;
    let generation = 0;
    let closed = false;
    function enqueue(produce: () => Promise<NavigationSnapshot>): Promise<NavigationSnapshot> {
        if (closed)
            return Promise.reject(new ExecutionError("configuration", "Navigation is closed"));
        const submittedGeneration = generation;
        const runCurrent = () => {
            if (closed || submittedGeneration !== generation) throw new ExecutionError("cancelled");
            return produce();
        };
        const run = inflight.then(runCurrent, runCurrent);
        inflight = run.catch(() => {});
        return run;
    }
    async function resolveTree(
        nextTree: NavigationNode,
        signal?: AbortSignal,
        historyMode?: "push" | "replace",
    ): Promise<NavigationSnapshot> {
        const ownGeneration = generation;
        const ids = new Set<string>();
        for (const dest of collectAllLeaves(nextTree)) {
            if (ids.has(dest.entryId)) throw new Error(`Duplicate entry ID: ${dest.entryId}`);
            ids.add(dest.entryId);
        }
        current = new AbortController();
        const combined = signal ? AbortSignal.any([signal, current.signal]) : current.signal;
        const execution = options.execution ?? framework.createExecution({ signal: combined });
        const unbind = bindExecutionCancellation(execution, combined);
        const check = () => {
            if (combined.aborted || ownGeneration !== generation)
                throw new ExecutionError("cancelled");
        };
        const destinations: ResolvedDestination[] = [];
        const resolvedLeaves = new Map<string, LeafNode>();
        let redirect: { url: string; status: number } | undefined;
        try {
            for (const dest of collectVisibleDestinations(nextTree)) {
                check();
                const key = resourceKey(dest.intent, dest.params, execution.context);
                const retained = pageCache.get(dest.entryId);
                const result = await loadPage({
                    framework,
                    target: dest,
                    execution,
                    signal: combined,
                    retained: retained?.resourceKey === key ? retained.page : undefined,
                    beforeLoad: options.beforeLoad,
                    afterLoad: options.afterLoad,
                    createContext: ({ url, intent, execution: active }) => {
                        const provided = options.createContext?.({
                            intent: intent.id,
                            params: intent.params ?? {},
                            signal: combined,
                            url,
                        });
                        return (
                            provided?.navigation ?? {
                                url,
                                path: new URL(url, "http://localhost").pathname,
                                params: intent.params ?? {},
                                intent,
                                isServer: options.isServer ?? true,
                                container: active.context.container,
                                getCookie: () => undefined,
                                getHeader: () => undefined,
                            }
                        );
                    },
                });
                check();
                if (result.kind === "page")
                    resolvedLeaves.set(
                        dest.entryId,
                        result.rewriteUrl
                            ? { ...result.target, entryId: dest.entryId, url: result.rewriteUrl }
                            : result.target,
                    );
                if (result.kind === "redirect") redirect ??= result;
                destinations.push({
                    ...(result.kind === "page" && result.match?.cache
                        ? { cache: result.match.cache }
                        : {}),
                    entryId: dest.entryId,
                    resourceKey:
                        result.kind === "page"
                            ? resourceKey(
                                  result.target.intent,
                                  result.target.params,
                                  execution.context,
                              )
                            : key,
                    intent: result.kind === "page" ? result.target.intent : dest.intent,
                    params: result.kind === "page" ? result.target.params : dest.params,
                    page:
                        result.kind === "page"
                            ? result.page
                            : getErrorPage(
                                  result.status,
                                  result.kind === "deny" ? result.message : "Redirecting",
                              ),
                    ...(result.kind !== "page" ? { status: result.status } : {}),
                });
            }
            check();
            const candidate = {
                tree: mapNavigationLeaves(
                    nextTree,
                    (node) => resolvedLeaves.get(node.entryId) ?? node,
                ),
                destinations,
                transitionId: generateUuid(),
                historyMode,
            };
            if (redirect) {
                options.onRedirect?.({ url: redirect.url, status: redirect.status });
                return candidate;
            }
            if (destinations.some((dest) => dest.status !== undefined)) return candidate;
            for (const dest of destinations) pageCache.set(dest.entryId, dest);
            for (const id of pageCache.keys()) if (!ids.has(id)) pageCache.delete(id);
            tree = candidate.tree;
            snapshot = candidate;
            for (const listener of listeners) listener(snapshot);
            await options.viewReady?.(snapshot);
            check();
            return snapshot;
        } finally {
            unbind();
            if (!options.execution) await execution.dispose();
        }
    }

    // ---------------------------------------------------------------
    // 内部：声明式操作 → 下一棵树（纯）
    // ---------------------------------------------------------------

    function computeNextTree(op: NavigationOperation): NavigationNode {
        switch (op.kind) {
            case NAVIGATION_OP_KINDS.REUSE_ENTRY:
                return reuseEntry(tree, op.entryId);
            case NAVIGATION_OP_KINDS.PUSH:
                return push(tree, leaf(op.intent, op.params, { url: op.url }), op.target);
            case NAVIGATION_OP_KINDS.POP:
                return pop(tree, op.count, op.target);
            case NAVIGATION_OP_KINDS.POP_TO_ROOT:
                return popToRoot(tree, op.target);
            case NAVIGATION_OP_KINDS.POP_TO:
                return popTo(tree, op.index, op.target);
            case NAVIGATION_OP_KINDS.REPLACE_TOP:
                return replaceTop(tree, leaf(op.intent, op.params, { url: op.url }), op.target);
            case NAVIGATION_OP_KINDS.SELECT_TAB:
                return selectTab(tree, op.key, op.target);
            case NAVIGATION_OP_KINDS.SELECT_COLUMN:
                return selectColumn(
                    tree,
                    op.columnId,
                    op.intent === undefined ? undefined : leaf(op.intent, op.params),
                    op.target,
                );
            case NAVIGATION_OP_KINDS.SET_VISIBILITY:
                return setVisibility(tree, op.visibility, op.target);
            case NAVIGATION_OP_KINDS.HYDRATE:
                return op.tree;
        }
    }

    // ---------------------------------------------------------------
    // 公共 API
    // ---------------------------------------------------------------

    function apply(
        op: NavigationOperation,
        invocation?: { signal?: AbortSignal },
    ): Promise<NavigationSnapshot> {
        return enqueue(() => {
            return resolveTree(
                computeNextTree(op),
                invocation?.signal,
                op.kind === "replaceTop" ? "replace" : "push",
            );
        });
    }

    return {
        getTree() {
            return tree;
        },
        getSnapshot() {
            return snapshot;
        },
        apply,
        reuseEntry(entryId) {
            return apply({ kind: "reuseEntry", entryId });
        },
        async dispose() {
            closed = true;
            generation++;
            current?.abort();
            await inflight;
            listeners.clear();
            pageCache.clear();
        },
        cancel() {
            generation++;
            current?.abort();
        },
        push(intent, params, opts) {
            return apply({
                kind: NAVIGATION_OP_KINDS.PUSH,
                intent,
                params,
                target: opts?.target,
                url: opts?.url,
            });
        },
        pop(count) {
            return apply({ kind: NAVIGATION_OP_KINDS.POP, count });
        },
        popToRoot() {
            return apply({ kind: NAVIGATION_OP_KINDS.POP_TO_ROOT });
        },
        replaceTop(intent, params) {
            return apply({ kind: NAVIGATION_OP_KINDS.REPLACE_TOP, intent, params });
        },
        selectTab(key, target) {
            return apply({ kind: NAVIGATION_OP_KINDS.SELECT_TAB, key, target });
        },
        selectColumn(columnId, intent, params, target) {
            return apply({
                kind: NAVIGATION_OP_KINDS.SELECT_COLUMN,
                columnId,
                intent,
                params,
                target,
            });
        },
        setVisibility(visibility, target) {
            return apply({ kind: NAVIGATION_OP_KINDS.SET_VISIBILITY, visibility, target });
        },
        hydrate(nextTree) {
            return apply({ kind: NAVIGATION_OP_KINDS.HYDRATE, tree: nextTree });
        },
        invalidate(entryKey) {
            if (entryKey === undefined) {
                pageCache.clear();
            } else {
                pageCache.delete(entryKey);
            }
        },
        refresh() {
            return enqueue(async () => {
                const active = findActiveLeaf(tree);
                if (active) {
                    pageCache.delete(active.entryId);
                }
                return resolveTree(tree);
            });
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        resolve() {
            // resolve() 对当前树做解析；缓存为空时全部 dispatch，非空时复用仍在树中的条目。
            // 与 apply 共用串行队列，避免 resolve 与并发 apply 互相覆盖。
            return enqueue(async () => {
                return resolveTree(tree);
            });
        },
    };
}

// =====================================================================
// 内部辅助
// =====================================================================

/** 找到树中「激活路径」末端的 leaf；无（如空 stack/空 split）则返回 undefined。 */
function findActiveLeaf(tree: NavigationNode): LeafNode | undefined {
    const path: NavigationPath = resolveActivePath(tree);
    const node = findNode(tree, path);
    if (node === undefined) return undefined;
    return node.kind === "leaf" ? node : undefined;
}
