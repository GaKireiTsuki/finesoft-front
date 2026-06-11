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

import type { Container } from "../dependencies/container";
import type { IntentDispatcher } from "../intents/dispatcher";
import type { Intent } from "../intents/types";
import type {
    AfterLoadGuard,
    BeforeLoadGuard,
    NavigationContext,
    PostLoadContext,
} from "../middleware/types";
import { runAfterLoadGuards, runBeforeLoadGuards } from "../middleware/pipeline";
import type { BasePage } from "../models/page";
import type { PrefetchedIntents } from "../prefetched-intents/prefetched-intents";
import { stableStringify } from "../prefetched-intents/stable-stringify";
import type { Router } from "../router/router";
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
} as const;

/** 所有导航操作 Kind 的联合类型 */
export type NavigationOpKind = (typeof NAVIGATION_OP_KINDS)[keyof typeof NAVIGATION_OP_KINDS];

/** push：在目标栈顶压入一个新 leaf（intent + params）。 */
export interface PushOperation {
    readonly kind: typeof NAVIGATION_OP_KINDS.PUSH;
    readonly intent: string;
    readonly params?: RouteParams;
    readonly target?: NavigationPath;
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
    /** Intent 派发器（派发可见目标的 intent → page）。 */
    readonly intentDispatcher: IntentDispatcher;
    /** 路由器（beforeLoad rewrite/redirect 时把 URL 重解析为 leaf）。 */
    readonly router: Router;
    /** 初始导航树（单 LeafNode = 今天的扁平单页）。 */
    readonly initial: NavigationNode;
    /** 应用提供的「目标 → 派发上下文」构建回调。 */
    readonly createContext: (input: NavigationContextInput) => NavigationDispatchContext;
    /**
     * 是否运行在服务端——仅用于 `createContext` 未返回 `navigation` 时的最小兜底上下文，
     * 决定该上下文的 `isServer` 字段。缺省时按运行环境推断（`typeof window === "undefined"`）。
     * 应用若已通过 `createContext` 提供完整 `navigation`，此项不生效。
     */
    readonly isServer?: boolean;
    /** 目标级 beforeLoad 守卫（在全局/路由守卫之外，由控制器对主目标执行）。 */
    readonly beforeLoad?: readonly BeforeLoadGuard[];
    /** 目标级 afterLoad 守卫。 */
    readonly afterLoad?: readonly AfterLoadGuard[];
    /** SSR 预取缓存（浏览器 hydration 时复用服务端解析结果）。 */
    readonly prefetched?: PrefetchedIntents;
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
    apply(op: NavigationOperation): Promise<NavigationSnapshot>;
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
     * 清除页面缓存：给 `entryKey`（= `sessionEntryKey(intent, params)`）清单个，
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
    readonly target?: NavigationPath;
}

// =====================================================================
// 实现
// =====================================================================

/** 可见目标的稳定身份键：intent + 稳定序列化的 params。 */
function destinationKey(intent: string, params: RouteParams): string {
    return `${intent} ${stableStringify(params)}`;
}

/** 默认兜底错误页（应用未提供 getErrorPage 时）。 */
function defaultErrorPage(status: number, message: string): Page {
    return {
        id: `error-${status}`,
        pageType: "error",
        title: message,
        description: message,
    };
}

export function createNavigationController(
    options: NavigationControllerOptions,
): NavigationController {
    const {
        intentDispatcher,
        router,
        createContext,
        beforeLoad = [],
        afterLoad = [],
        prefetched,
        getErrorPage = defaultErrorPage,
        onRedirect,
    } = options;

    // 运行环境：浏览器（有 window）→ 非服务端；否则视为服务端。
    // 用于 minimalContext 兜底（应用未提供 navigation 时）填正确的 isServer。
    const isServer = options.isServer ?? typeof window === "undefined";

    let tree: NavigationNode = options.initial;
    let snapshot: NavigationSnapshot = { tree, destinations: [] };
    const listeners = new Set<(snapshot: NavigationSnapshot) => void>();

    // 按条目身份键缓存已成功解析的目标（ResolvedDestination）。
    // 复用源 = 此缓存（超集：含上一快照 + 所有仍在树中的已解析条目）。
    // 每轮提交后写穿（仅 status===undefined 的成功页）并按 collectAllLeaves prune：
    // 条目离树（pop 掉、tab 分支销毁）→ 其缓存清除（与作用域状态同一生命周期）。
    const pageCache = new Map<string, ResolvedDestination>();

    // 串行化所有异步操作的尾指针：每个 apply/resolve 链到上一个之后再 computeNextTree，
    // 保证「读最新已提交 tree → 解析 → 提交」三步对同一操作原子化，杜绝并发 last-write-wins。
    // 链上某次操作 reject 不污染后续：catch 兜住异常、用当前已提交 snapshot 续链。
    let inflight: Promise<NavigationSnapshot> = Promise.resolve(snapshot);

    /**
     * 把一个「计算下一棵树 + 解析 + 提交」的工作单元排到串行队列尾部。
     * `produce` 在前一操作完全提交后才执行，因而它内部读取的 `tree`/`snapshot` 始终是最新的。
     */
    function enqueue(produce: () => Promise<NavigationSnapshot>): Promise<NavigationSnapshot> {
        const run = inflight.then(produce, produce);
        // 尾指针只跟踪「是否已结算」，吞掉拒绝，避免一次失败让整条链永久 rejected。
        inflight = run.then(
            (s) => s,
            () => snapshot,
        );
        return run;
    }

    // ---------------------------------------------------------------
    // 内部：解析一棵树 → 快照
    // ---------------------------------------------------------------

    /**
     * 解析 `nextTree` 的全部可见目标，返回新快照（纯计算 + 读写 pageCache，不改 `tree`/`snapshot`）。
     *
     * - 复用：可见目标命中 `pageCache` 时，主目标把缓存页喂给 `resolvePrimary`（守卫照常跑、
     *   跳过 dispatch），次目标直接复用缓存结果。
     * - 写穿：本轮解析出的**成功**目标（`status===undefined`）写入缓存；失败/deny/redirect
     *   目标不缓存（并清除其旧缓存），保证下次 reveal 重试 + 不复用错误页。
     * - prune：按 `collectAllLeaves(nextTree)`（全部存在条目）裁剪，离树条目缓存清除。
     */
    async function resolveTree(nextTree: NavigationNode): Promise<NavigationSnapshot> {
        const visible = collectVisibleDestinations(nextTree);

        // 主目标 = 激活路径末端的 leaf（与现有 runner 的「单页」对齐）。
        const activeLeaf = findActiveLeaf(nextTree);
        const primaryKey = activeLeaf
            ? destinationKey(activeLeaf.intent, activeLeaf.params)
            : undefined;

        const destinations: ResolvedDestination[] = [];

        for (const dest of visible) {
            const key = destinationKey(dest.intent, dest.params);
            const isPrimary = primaryKey !== undefined && key === primaryKey;
            const cached = pageCache.get(key);

            if (isPrimary) {
                // 主目标始终跑守卫；命中缓存时把缓存页喂入 → 跳过 dispatch（不重 fetch）。
                destinations.push(await resolvePrimary(dest, cached?.page));
            } else if (cached !== undefined) {
                // 非主、已缓存：直接复用（不 dispatch、不跑守卫）。
                destinations.push(cached);
            } else {
                // 非主、未缓存：仅 dispatch（含 prefetched 复用），无守卫。
                destinations.push(await resolveSecondary(dest));
            }
        }

        // 注意：若 beforeLoad 改写了 intent/params，这里按解析后键写入，可能与树键（仍是改写前的 leaf）
        // 不同 → 会被下面的 prune 即时清除。这是有意的：改写后的页面不缓存、不复用。
        // 写穿 + prune。
        for (const d of destinations) {
            const k = destinationKey(d.intent, d.params);
            if (d.status === undefined) {
                pageCache.set(k, d);
            } else {
                pageCache.delete(k); // 失败/deny/redirect 不缓存，清旧缓存避免复用错误页。
            }
        }
        const presentKeys = new Set(
            collectAllLeaves(nextTree).map((l) => destinationKey(l.intent, l.params)),
        );
        for (const k of pageCache.keys()) {
            if (!presentKeys.has(k)) pageCache.delete(k);
        }

        return { tree: nextTree, destinations };
    }

    /**
     * 解析主目标：跑 beforeLoad → dispatch（或复用页）→ afterLoad，处理守卫结果。
     * 返回该目标的解析结果（可能因 rewrite 而换了 intent/params）。
     */
    async function resolvePrimary(
        dest: LeafNode,
        reusedPage: Page | undefined,
    ): Promise<ResolvedDestination> {
        let intent = dest.intent;
        let params = dest.params;
        let ctx = createContext({ intent, params });
        let navCtx = ctx.navigation ?? minimalContext(intent, params, ctx);

        // ===== beforeLoad =====
        const beforeResult = await runBeforeLoadGuards(beforeLoad as BeforeLoadGuard[], navCtx);

        if (beforeResult.kind === "redirect") {
            onRedirect?.({ url: beforeResult.url, status: beforeResult.status });
            return {
                intent,
                params,
                page: reusedPage ?? getErrorPage(beforeResult.status, "Redirecting"),
                status: beforeResult.status,
            };
        }
        if (beforeResult.kind === "deny") {
            return {
                intent,
                params,
                page: getErrorPage(beforeResult.status, beforeResult.message),
                status: beforeResult.status,
            };
        }
        if (beforeResult.kind === "rewrite") {
            // rewrite ≈ 换 URL 重路由：把新 URL 解析成 leaf，替换主目标的 intent/params。
            const rewritten = await resolveUrlToLeaf(beforeResult.url);
            if (rewritten) {
                intent = rewritten.intent;
                params = rewritten.params;
                ctx = createContext({ intent, params });
                navCtx = ctx.navigation ?? minimalContext(intent, params, ctx);
                // rewrite 后是新 intent，不能复用旧页。
                reusedPage = undefined;
            }
        }

        // ===== dispatch =====
        const dispatched = await dispatchDestination(intent, params, ctx, reusedPage);

        // dispatch 失败：记录 status + 兜底页，不跑 afterLoad（与 SSR：dispatch catch 后仍渲染兜底页对齐，
        // 但兜底页不再经 afterLoad 守卫——afterLoad 期望真实 page，这里保持最小副作用）。
        if (dispatched.status !== undefined) {
            return { intent, params, page: dispatched.page, status: dispatched.status };
        }

        // ===== afterLoad =====
        const postCtx: PostLoadContext = { ...navCtx, page: dispatched.page };
        const afterResult = await runAfterLoadGuards(afterLoad as AfterLoadGuard[], postCtx);

        if (afterResult.kind === "redirect") {
            onRedirect?.({ url: afterResult.url, status: afterResult.status });
            return { intent, params, page: dispatched.page, status: afterResult.status };
        }
        if (afterResult.kind === "deny") {
            return { intent, params, page: dispatched.page, status: afterResult.status };
        }
        // afterLoad rewrite：数据已加载，仅 canonical URL（不重跑），page 保留、不打 status。

        return { intent, params, page: dispatched.page };
    }

    /** 解析非主目标：只 dispatch（含 prefetched 复用），无守卫——与现有 runner 一致（守卫只跑主目标）。 */
    async function resolveSecondary(dest: LeafNode): Promise<ResolvedDestination> {
        const ctx = createContext({ intent: dest.intent, params: dest.params });
        const dispatched = await dispatchDestination(dest.intent, dest.params, ctx, undefined);
        return {
            intent: dest.intent,
            params: dest.params,
            page: dispatched.page,
            ...(dispatched.status !== undefined ? { status: dispatched.status } : {}),
        };
    }

    /**
     * 派发单个目标的 intent → page；失败时复刻 controller 的 fallback：
     * 不抛出，返回兜底页 + status=500（不让单目标失败炸穿 `apply`）。
     * `reusedPage` 命中时直接复用，跳过 dispatch。
     */
    async function dispatchDestination(
        intent: string,
        params: RouteParams,
        ctx: NavigationDispatchContext,
        reusedPage: Page | undefined,
    ): Promise<{ page: Page; status?: number }> {
        if (reusedPage !== undefined) {
            return { page: reusedPage };
        }
        const intentObj: Intent<BasePage> = { id: intent, params };
        // 先查预取缓存（一次性消费）——与 Framework.dispatch 的 prefetched 优先级一致。
        const cached = prefetched?.get<BasePage>(intentObj);
        if (cached !== undefined) {
            return { page: cached };
        }
        try {
            const page = await intentDispatcher.dispatch(intentObj, ctx.container);
            return { page };
        } catch {
            return { page: getErrorPage(500, "Internal error"), status: 500 };
        }
    }

    /** 构建最小 NavigationContext（应用未提供 navigation 时的兜底，无 cookie/header）。 */
    function minimalContext(
        intent: string,
        params: RouteParams,
        ctx: NavigationDispatchContext,
    ): NavigationContext {
        const url = ctx.url ?? "/";
        let path = url;
        try {
            path = new URL(url, "http://localhost").pathname;
        } catch {
            path = url.split("?")[0].split("#")[0];
        }
        return {
            url,
            path,
            params,
            intent: { id: intent, params },
            isServer,
            container: ctx.container,
            getCookie: () => undefined,
            getHeader: () => undefined,
        };
    }

    /** 把 URL 解析为单个 LeafNode（beforeLoad rewrite / hydration fallback 用）。 */
    async function resolveUrlToLeaf(url: string): Promise<LeafNode | undefined> {
        const match = await router.resolve(url);
        if (!match) return undefined;
        return leaf(match.intent.id, (match.intent.params ?? {}) as RouteParams);
    }

    // ---------------------------------------------------------------
    // 内部：提交 + 通知
    // ---------------------------------------------------------------

    function commit(next: NavigationSnapshot): NavigationSnapshot {
        tree = next.tree;
        snapshot = next;
        for (const listener of listeners) {
            listener(snapshot);
        }
        return snapshot;
    }

    // ---------------------------------------------------------------
    // 内部：声明式操作 → 下一棵树（纯）
    // ---------------------------------------------------------------

    function computeNextTree(op: NavigationOperation): NavigationNode {
        switch (op.kind) {
            case NAVIGATION_OP_KINDS.PUSH:
                return push(tree, leaf(op.intent, op.params), op.target);
            case NAVIGATION_OP_KINDS.POP:
                return pop(tree, op.count, op.target);
            case NAVIGATION_OP_KINDS.POP_TO_ROOT:
                return popToRoot(tree, op.target);
            case NAVIGATION_OP_KINDS.POP_TO:
                return popTo(tree, op.index, op.target);
            case NAVIGATION_OP_KINDS.REPLACE_TOP:
                return replaceTop(tree, leaf(op.intent, op.params), op.target);
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

    function apply(op: NavigationOperation): Promise<NavigationSnapshot> {
        return enqueue(async () => {
            const nextTree = computeNextTree(op);
            const next = await resolveTree(nextTree);
            return commit(next);
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
        push(intent, params, opts) {
            return apply({
                kind: NAVIGATION_OP_KINDS.PUSH,
                intent,
                params,
                target: opts?.target,
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
                    pageCache.delete(destinationKey(active.intent, active.params));
                }
                const next = await resolveTree(tree);
                return commit(next);
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
                const next = await resolveTree(tree);
                return commit(next);
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
