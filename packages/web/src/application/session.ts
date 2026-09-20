/**
 * One WebSession owns navigation transactions and native view snapshots.
 * EntryId indexes both visible and retained pages in stable mount order.
 * Browser history, DOM acknowledgement and storage remain host responsibilities.
 */

import {
    ExecutionError,
    generateUuid,
    type ExecutionHandle,
    type ExecutionContext,
    type Container,
} from "@finesoft/core";
import type { WebRuntime } from "../application/runtime";
import { WEB_EXECUTION, type WebExecutionState } from "../application/definition";
import { loadPage } from "../application/load-page";
import type { AfterLoadGuard, BeforeLoadGuard, NavigationContext } from "../middleware/types";
import { bindExecutionCancellation } from "../application/execution";
import { notifyObservers } from "../utils/notify-observers";
import { deserializeNavigation, serializeNavigation } from "../navigation/serialization";
import { SessionError, type SessionNavigation, type SessionStore } from "../session/types";
import { ActionDispatcher } from "../actions/dispatcher";
import { ACTION_KINDS, type ActionInvocation, type TreeAction } from "../actions/types";
import type { WebAppDefinition } from "./types";
import type { AppSnapshot, NavigationSummary, ViewEntry, WebAppView } from "./view";
import { resourceKey } from "../navigation/keys";
import type { RouteParams } from "../router/types";
import { leaf, stack } from "../navigation/nodes";
import {
    collectAllLeaves,
    visibleSplitColumns,
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
} from "../navigation/operations";
import type {
    LeafNode,
    NavigationNode,
    NavigationPath,
    NavigationSnapshot,
    Page,
    ResolvedDestination,
} from "../navigation/types";

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
 *   其中 isServer 取 `WebSessionOptions.isServer`，缺省按运行环境推断）。
 *
 * `signal` propagates to guarded page loading and the existing execution scope.
 */
export interface NavigationContextInput {
    readonly execution: ExecutionContext;
    readonly intent: string;
    readonly params: RouteParams;
    readonly query?: RouteParams;
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
// WebSessionOptions / WebSession
// =====================================================================

/** Admission runs once per transaction; page redirects do not repeat it. */
export type BeforeNavigateResult =
    | import("../middleware/types").NextResult
    | import("../middleware/types").DenyResult
    | import("../middleware/types").RedirectResult;
/** The final candidate can only be accepted or denied, never redirected after inspection. */
export type BeforeCommitResult = Exclude<BeforeNavigateResult, { kind: "redirect" }>;
export interface NavigationTransactionContext {
    readonly from: NavigationSnapshot;
    readonly tree: NavigationNode;
    readonly transitionId: string;
    readonly execution: ExecutionContext;
    readonly signal: AbortSignal;
    readonly isServer: boolean;
}
export interface NavigationCommitContext extends NavigationTransactionContext {
    readonly candidate: NavigationSnapshot;
}
export type BeforeNavigatePolicy = (
    context: NavigationTransactionContext,
) => BeforeNavigateResult | Promise<BeforeNavigateResult>;
export type BeforeCommitPolicy = (
    context: NavigationCommitContext,
) => BeforeCommitResult | Promise<BeforeCommitResult>;

export interface WebSessionOptions<Definition extends WebAppDefinition = WebAppDefinition> {
    readonly commit?: (revision: number) => void;
    readonly session?: () => SessionStore | undefined;
    readonly captureUrl?: () => string | undefined;
    readonly beforeNavigate?: readonly BeforeNavigatePolicy[];
    readonly beforeCommit?: readonly BeforeCommitPolicy[];
    readonly web: WebRuntime<Definition>;
    readonly execution?: ExecutionHandle;
    readonly viewReady?: (
        snapshot: NavigationSnapshot,
        signal?: AbortSignal,
    ) => void | Promise<void>;
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
     * Called after the redirecting execution finishes. Return a tree to follow within
     * this same queued operation (at most five follows), preserving cancellation and
     * history mode. Return void to report an HTTP redirect or finish an external handoff.
     * Do not call queued controller operations from this callback.
     */
    readonly onRedirect?: (
        redirect: { url: string; status: number },
        candidate: NavigationSnapshot,
    ) => void | NavigationNode | Promise<void | NavigationNode>;
}

/** Shared navigation, native view and persistence owner. */
export interface WebSession<Definition extends WebAppDefinition = WebAppDefinition>
    extends WebAppView<Definition>, SessionNavigation {
    /** Initial host presentation; rejected candidates are sanitized without committing them. */
    start(this: void, invocation?: ActionInvocation): Promise<AppSnapshot>;
    /** 当前导航树。 */
    getTree(this: void): NavigationNode;
    onCommit(
        this: void,
        listener: (snapshot: AppSnapshot, previous: AppSnapshot) => void,
    ): () => void;
    /** 当前快照（树 + 已解析的可见目标）。 */
    getSnapshot(this: void): AppSnapshot;
    cancel(this: void, invocation?: ActionInvocation): void;
    dispose(this: void): Promise<void>;
    /**
     * 清除页面缓存：给 `entryId` 清单个，
     * 不传清全部。仅清缓存、不触发重解析——该条目下次被解析时重新 dispatch。
     */
    invalidate(this: void, entryKey?: string): void;
    /** 订阅快照变更；返回取消订阅函数。 */
    subscribe(this: void, listener: (snapshot: AppSnapshot) => void): () => void;
}

// =====================================================================
// 实现
// =====================================================================

function defaultErrorPage(status: number, message: string): Page {
    return { id: `error-${status}`, pageType: "error", title: message };
}

const TREE_ACTION_KINDS = Object.values(ACTION_KINDS).filter(
    (kind) => kind !== "flow" && kind !== "externalUrl" && kind !== "compound",
);

export function createWebSession<Definition extends WebAppDefinition>(
    options: WebSessionOptions<Definition>,
): WebSession<Definition>;
export function createWebSession(options: WebSessionOptions): WebSession {
    const web = options.web;
    let locale: WebAppView["locale"], translator: WebAppView["translator"];
    const beforeNavigate = [
        ...(web.definition?.beforeNavigate ?? []),
        ...(options.beforeNavigate ?? []),
    ];
    const beforeCommit = [...(web.definition?.beforeCommit ?? []), ...(options.beforeCommit ?? [])];
    const getErrorPage = options.getErrorPage ?? web.definition?.getErrorPage ?? defaultErrorPage;
    let snapshot: AppSnapshot = Object.freeze({
        tree: options.initial,
        destinations: [],
        entries: [],
        revision: 0,
        navigation: summarize(options.initial),
    });
    const actions = new ActionDispatcher<NavigationSnapshot>(() => snapshot);
    const cancelActions = actions.cancel;
    // Initial failure is presentation only; actions and persistence still target the
    // original input until the first successful transaction commits.
    let retryInitial = false;
    const navigationTree = () => (retryInitial ? options.initial : snapshot.tree);
    const listeners = new Set<(snapshot: AppSnapshot) => void>();
    // Map insertion order is the stable native mount order, including retained hidden pages.
    const entries = new Map<string, ViewEntry>();
    let presentIds = new Set(collectAllLeaves(options.initial).map((entry) => entry.entryId));
    const stale = new Set<string>();
    const commitSteps = new Set<(snapshot: AppSnapshot, previous: AppSnapshot) => void>();
    let invalidationVersion = 0;
    const unsubscribeInvalidation = web.runtime.onInvalidate(() => {
        invalidationVersion++;
        for (const id of entries.keys()) stale.add(id);
    });
    let inflight: Promise<unknown> = Promise.resolve();
    const settling = new Set<Promise<unknown>>();
    let current: AbortController | undefined;
    let closed = false;
    function enqueue(produce: () => Promise<NavigationSnapshot>): Promise<NavigationSnapshot> {
        if (closed)
            return Promise.reject(new ExecutionError("configuration", "Navigation is closed"));
        const submittedGeneration = actions.generation;
        const runCurrent = () => {
            if (closed || submittedGeneration !== actions.generation)
                throw new ExecutionError("cancelled");
            return produce();
        };
        const run = inflight.then(runCurrent, runCurrent);
        settling.add(run);
        void run.then(
            () => settling.delete(run),
            () => settling.delete(run),
        );
        inflight = run.catch(() => {});
        return run;
    }
    async function resolveTree(
        nextTree: NavigationNode,
        signal?: AbortSignal,
        historyMode?: "push" | "replace",
        refreshEntryId?: string,
    ): Promise<NavigationSnapshot> {
        const ownGeneration = actions.generation;
        const check = () => {
            if (signal?.aborted) {
                options.execution?.cancel(signal.reason);
                throw new ExecutionError("cancelled");
            }
            if (closed || ownGeneration !== actions.generation)
                throw new ExecutionError("cancelled");
        };
        const transaction = {
            from: retryInitial ? { tree: options.initial, destinations: [] } : snapshot,
            transitionId: generateUuid(),
        };
        for (let redirects = 0; ; redirects++) {
            check();
            const result = await resolveCandidate(
                nextTree,
                transaction,
                redirects === 0,
                signal,
                historyMode,
                refreshEntryId,
            );
            check();
            if (!result.redirect) return result.snapshot;
            if (redirects === 5)
                throw new ExecutionError(
                    "configuration",
                    "Too many navigation redirects (maximum 5)",
                );
            // The previous execution has finished. Continue inside this queue operation,
            // never await another enqueue from the same queue.
            const redirectedTree = await options.onRedirect?.(result.redirect, result.snapshot);
            check();
            if (!redirectedTree) return result.snapshot;
            nextTree = redirectedTree;
        }
    }
    async function resolveCandidate(
        nextTree: NavigationNode,
        transaction: { from: NavigationSnapshot; transitionId: string },
        admission: boolean,
        signal?: AbortSignal,
        historyMode?: "push" | "replace",
        refreshEntryId?: string,
    ): Promise<{ snapshot: NavigationSnapshot; redirect?: { url: string; status: number } }> {
        const ownGeneration = actions.generation;
        const ownInvalidation = invalidationVersion;
        const ids = new Set<string>();
        for (const dest of collectAllLeaves(nextTree)) {
            if (ids.has(dest.entryId)) throw new Error(`Duplicate entry ID: ${dest.entryId}`);
            ids.add(dest.entryId);
        }
        current = new AbortController();
        const combined = signal ? AbortSignal.any([signal, current.signal]) : current.signal;
        const execution = options.execution ?? web.createExecution({ signal: combined });
        const unbind = bindExecutionCancellation(execution, combined);
        const check = () => {
            if (
                combined.aborted ||
                execution.context.signal.aborted ||
                ownGeneration !== actions.generation ||
                ownInvalidation !== invalidationVersion
            )
                throw new ExecutionError("cancelled");
        };
        const executionState = execution.context.bindings[WEB_EXECUTION] as WebExecutionState;
        const prefetched = executionState.prefetched;
        const stage = prefetched.stage();
        executionState.prefetched = stage.cache;
        const context: NavigationTransactionContext = {
            ...transaction,
            tree: nextTree,
            execution: execution.context,
            signal: execution.context.signal,
            isServer: options.isServer ?? true,
        };
        const reject = (result: BeforeNavigateResult, candidate: NavigationSnapshot) => ({
            snapshot: {
                ...candidate,
                ...(result.kind === "deny" ? { rejection: result } : {}),
                ...(result.kind === "redirect"
                    ? { redirect: { url: result.url, status: result.status } }
                    : {}),
            },
            ...(result.kind === "redirect"
                ? { redirect: { url: result.url, status: result.status } }
                : {}),
        });
        const destinations: ResolvedDestination[] = [];
        const resolvedLeaves = new Map<string, LeafNode>();
        let redirect: { url: string; status: number } | undefined;
        try {
            if (admission)
                for (const policy of beforeNavigate) {
                    check();
                    const result = await policy(context);
                    check();
                    if (!result || !["next", "deny", "redirect"].includes(result.kind))
                        throw new ExecutionError("configuration", "Invalid beforeNavigate result");
                    if (result.kind !== "next")
                        return reject(result, {
                            tree: nextTree,
                            destinations: [],
                            transitionId: transaction.transitionId,
                            historyMode,
                        });
                }
            for (const dest of collectVisibleDestinations(nextTree)) {
                check();
                const key = resourceKey(dest.intent, dest.params, execution.context, dest.query);
                const retained =
                    retryInitial || dest.entryId === refreshEntryId || stale.has(dest.entryId)
                        ? undefined
                        : entries.get(dest.entryId);
                const result = await loadPage({
                    web,
                    target: dest,
                    execution,
                    signal: combined,
                    retained: retained?.resourceKey === key ? retained.page : undefined,
                    beforeLoad: options.beforeLoad,
                    afterLoad: options.afterLoad,
                    createContext: ({ url, intent, execution: active }) => {
                        const provided = options.createContext?.({
                            execution: active.context,
                            intent: intent.id,
                            params: intent.params ?? {},
                            query: intent.query ?? {},
                            signal: combined,
                            url,
                        });
                        return (
                            provided?.navigation ?? {
                                url,
                                path: new URL(url, "http://localhost").pathname,
                                params: intent.params ?? {},
                                query: intent.query ?? {},
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
                    ...(result.kind === "page"
                        ? { renderMode: result.match?.renderMode, rewriteUrl: result.rewriteUrl }
                        : {}),
                    entryId: dest.entryId,
                    resourceKey:
                        result.kind === "page"
                            ? resourceKey(
                                  result.target.intent,
                                  result.target.params,
                                  execution.context,
                                  result.target.query,
                              )
                            : key,
                    intent: result.kind === "page" ? result.target.intent : dest.intent,
                    params: result.kind === "page" ? result.target.params : dest.params,
                    query: result.kind === "page" ? result.target.query : dest.query,
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
                transitionId: transaction.transitionId,
                historyMode,
            };
            if (redirect) {
                return {
                    snapshot: candidate,
                    redirect: { url: redirect.url, status: redirect.status },
                };
            }
            if (destinations.some((dest) => dest.status !== undefined))
                return { snapshot: candidate };
            for (const policy of beforeCommit) {
                check();
                const result = await policy({ ...context, tree: candidate.tree, candidate });
                check();
                if (!result || !["next", "deny"].includes(result.kind))
                    throw new ExecutionError(
                        "configuration",
                        "Invalid beforeCommit result: only next or deny is supported",
                    );
                if (result.kind === "deny") return reject(result, candidate);
            }
            check();
            stage.commit();
            const previous = snapshot;
            publish(candidate, ids);
            for (const dest of destinations) stale.delete(dest.entryId);
            const commitErrors: unknown[] = [];
            for (const step of commitSteps) {
                try {
                    step(snapshot, previous);
                } catch (error) {
                    commitErrors.push(error);
                }
            }
            notifyObservers(
                listeners,
                () =>
                    web.runtime.record("session.observer-error", {
                        transitionId: snapshot.transitionId,
                    }),
                snapshot,
            );
            try {
                await options.viewReady?.(snapshot, combined);
                check();
            } catch (error) {
                commitErrors.push(error);
            }
            if (commitErrors.length) throw new NavigationCommitError(snapshot, commitErrors);
            return { snapshot };
        } finally {
            executionState.prefetched = prefetched;
            unbind();
            if (!options.execution) await execution.dispose();
        }
    }

    function publish(candidate: NavigationSnapshot, ids: Set<string>) {
        if (retryInitial) {
            entries.clear();
            stale.clear();
        }
        retryInitial = false;
        const visible = new Set(candidate.destinations.map((entry) => entry.entryId));
        for (const [id, entry] of entries) {
            if (!ids.has(id)) {
                entries.delete(id);
                stale.delete(id);
            } else if (entry.visible && !visible.has(id))
                entries.set(id, Object.freeze({ ...entry, visible: false }));
        }
        for (const entry of candidate.destinations) {
            const old = entries.get(entry.entryId);
            if (
                !old ||
                !old.visible ||
                old.page !== entry.page ||
                old.resourceKey !== entry.resourceKey ||
                old.status !== entry.status ||
                old.cache !== entry.cache ||
                old.renderMode !== entry.renderMode ||
                old.rewriteUrl !== entry.rewriteUrl
            )
                entries.set(entry.entryId, Object.freeze({ ...entry, visible: true }));
        }
        presentIds = ids;
        snapshot = Object.freeze({
            ...candidate,
            revision: snapshot.revision + 1,
            destinations: Object.freeze(
                candidate.destinations.map((entry) => entries.get(entry.entryId)!),
            ),
            entries: Object.freeze([...entries.values()]),
            navigation: summarize(candidate.tree),
        });
    }

    // ---------------------------------------------------------------
    // 内部：声明式操作 → 下一棵树（纯）
    // ---------------------------------------------------------------

    function computeNextTree(op: TreeAction): NavigationNode {
        const tree = navigationTree();
        switch (op.kind) {
            case ACTION_KINDS.REUSE_ENTRY:
                return reuseEntry(tree, op.entryId);
            case ACTION_KINDS.PUSH:
                return push(
                    tree,
                    leaf(op.intent, op.params, { url: op.url, query: op.query }),
                    op.target,
                );
            case ACTION_KINDS.POP:
                return pop(tree, op.count, op.target);
            case ACTION_KINDS.POP_TO_ROOT:
                return popToRoot(tree, op.target);
            case ACTION_KINDS.POP_TO:
                return popTo(tree, op.index, op.target);
            case ACTION_KINDS.REPLACE_TOP:
                return replaceTop(
                    tree,
                    leaf(op.intent, op.params, { url: op.url, query: op.query }),
                    op.target,
                );
            case ACTION_KINDS.SELECT_TAB:
                return selectTab(tree, op.key, op.target);
            case ACTION_KINDS.SELECT_COLUMN:
                return selectColumn(
                    tree,
                    op.columnId,
                    op.intent === undefined
                        ? undefined
                        : leaf(op.intent, op.params, { query: op.query }),
                    op.target,
                );
            case ACTION_KINDS.SET_VISIBILITY:
                return setVisibility(tree, op.visibility, op.target);
            case ACTION_KINDS.HYDRATE:
                return op.tree;
            case ACTION_KINDS.REFRESH:
                return tree;
        }
    }

    // ---------------------------------------------------------------
    // 公共 API
    // ---------------------------------------------------------------

    function performTree(
        op: TreeAction,
        invocation?: ActionInvocation,
    ): Promise<NavigationSnapshot> {
        return enqueue(() => {
            return resolveTree(
                computeNextTree(op),
                invocation?.signal,
                op.kind === "refresh" ? undefined : op.kind === "replaceTop" ? "replace" : "push",
                op.kind === "refresh" ? findActiveLeaf(navigationTree())?.entryId : undefined,
            );
        });
    }

    for (const kind of TREE_ACTION_KINDS) actions.onAction<TreeAction>(kind, performTree);
    // Preserve live getters while giving the action executor its state and lifecycle.
    const session = Object.assign(actions, {
        runtime: web.runtime,
        commit(revision) {
            if (revision === snapshot.revision) options.commit?.(revision);
        },
        captureNavigation: () => serializeNavigation(navigationTree()),
        captureUrl: options.captureUrl,
        presentKeys: () => presentIds.values(),
        async restoreNavigation(navigation) {
            if (navigation === undefined) return;
            const candidate = await session.perform({
                kind: "hydrate",
                tree: deserializeNavigation(navigation),
            });
            if (candidate !== snapshot) throw new SessionError("navigation-uncommitted");
        },
        async start(invocation) {
            if (snapshot.revision)
                throw new ExecutionError("configuration", "Web session already started");
            const ownGeneration = actions.generation;
            [locale, translator] = await Promise.all([
                web.getLocale(options.execution),
                web.getTranslator(options.execution),
            ]);
            if (closed || ownGeneration !== actions.generation || invocation?.signal?.aborted)
                throw new ExecutionError("cancelled");
            const candidate = await enqueue(() =>
                resolveTree(navigationTree(), invocation?.signal),
            );
            if (closed || ownGeneration !== actions.generation)
                throw new ExecutionError("cancelled");
            if (candidate !== snapshot) {
                let result = candidate;
                if (candidate.rejection) {
                    const { status, message } = candidate.rejection;
                    const error = leaf("@finesoft/error");
                    result = {
                        tree: stack(error),
                        destinations: [
                            {
                                ...error,
                                resourceKey: resourceKey(error.intent, error.params),
                                page: getErrorPage(status, message),
                                status,
                            },
                        ],
                    };
                }
                publish(
                    result,
                    new Set(collectAllLeaves(options.initial).map((entry) => entry.entryId)),
                );
                retryInitial = true;
            }
            return snapshot;
        },
        onCommit(listener) {
            commitSteps.add(listener);
            return () => {
                commitSteps.delete(listener);
            };
        },
        getTree() {
            return navigationTree();
        },
        getSnapshot() {
            return snapshot;
        },
        async dispose() {
            closed = true;
            actions.close();
            current?.abort();
            await Promise.allSettled(settling);
            unsubscribeInvalidation();
            listeners.clear();
            commitSteps.clear();
            entries.clear();
            stale.clear();
        },
        cancel(invocation) {
            cancelActions(invocation);
            current?.abort();
            // A cancelled handler may still be settling. Its generation cannot commit,
            // but it must not hold the next navigation behind its ignored abort signal.
            inflight = Promise.resolve();
        },
        invalidate(entryKey) {
            if (entryKey === undefined) {
                for (const id of entries.keys()) stale.add(id);
            } else {
                stale.add(entryKey);
            }
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    } satisfies Omit<
        WebSession,
        "perform" | "onAction" | "removeAction"
    >) as ActionDispatcher<NavigationSnapshot> & WebSession;
    Object.defineProperties(session, {
        session: { get: () => options.session?.(), enumerable: true },
        locale: { get: () => locale, enumerable: true },
        translator: { get: () => translator, enumerable: true },
    });
    return session;
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

/** State is already committed; observers and hosts must not report a pre-commit rejection. */
export class NavigationCommitError extends Error {
    readonly committed = true;
    constructor(
        readonly snapshot: NavigationSnapshot,
        causes: unknown[],
    ) {
        super("Navigation committed but host presentation failed", {
            cause: new AggregateError(causes),
        });
        this.name = "NavigationCommitError";
    }
}

function summarize(tree: NavigationNode): NavigationSummary {
    let node: NavigationNode | undefined = tree;
    let canGoBack = false;
    let tabs: NavigationSummary["tabs"];
    while (node) {
        if (node.kind === "leaf") return { canGoBack, tabs, activeEntryId: node.entryId };
        if (node.kind === "stack") {
            canGoBack ||= node.entries.length > 1;
            node = node.entries.at(-1);
        } else if (node.kind === "tabs") {
            tabs = { active: node.active, order: node.order };
            node = node.branches[node.active];
        } else node = visibleSplitColumns(node).at(-1)?.content;
    }
    return { canGoBack, tabs };
}
