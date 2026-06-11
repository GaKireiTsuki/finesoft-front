/**
 * ssrRenderNavigation — 结构化导航的 SSR 渲染管线
 *
 * 在不破坏现有「扁平单页」`ssrRender` 的前提下，给框架补上多区域导航的服务端渲染：
 *
 * 1. 从 URL 用 `codec.decode` 还原初始树（无结构化覆盖时退化为「`Router.resolve` →
 *    单个 LeafNode」，即今天的行为）。
 * 2. 构建 `NavigationController`，`resolve()` 一次性预取 **所有可见目标**
 *    （split 同时展示多列 → 多个 `ResolvedDestination`）。
 * 3. 把快照（树 + 每个目标的预取结果）经 **既有 `PrefetchedIntents` 通道** 序列化进
 *    HTML：每个可见目标产出一条 `{ intent, data: page }`（与单页 SSR 完全一致的形态），
 *    再额外挂一条 **哨兵条目** 承载 `serializeNavigation(tree)`。哨兵复用同一个
 *    `#serialized-server-data` 脚本，因此 `@finesoft/server` 层零改动即可透传。
 *
 * 浏览器侧用 `extractNavigationTree` 取出树、`stripNavigationTree` 把哨兵剔除后，
 * 剩下的纯目标条目交给现有 `PrefetchedIntents.fromArray` 还原——每个目标按
 * `stableStringify(intent)` 命中，`NavigationController` 的 dispatch 优先复用，
 * 不再回服务端取数。
 *
 * 应用不启用导航（不传 `navigation`）时调用方继续走 `ssrRender` 的单页路径；本模块
 * 对单 LeafNode 树的行为与单页 SSR 完全等价（仅 `serverData` 多一条树哨兵）。
 */

import {
    Framework,
    createNavigationController,
    createServerContext,
    deserializeNavigation,
    leaf,
    markPublic,
    resolveConfiguredMessages,
    serializeNavigation,
    type AfterLoadGuard,
    type BasePage,
    type BeforeLoadGuard,
    type FrameworkConfig,
    type MessagesLoader,
    type NavigationCodec,
    type NavigationController,
    type NavigationDispatchContext,
    type NavigationNode,
    type NavigationSnapshot,
    type PrefetchedIntent,
    type ResolvedDestination,
    type SerializedNavigation,
    type TranslationMessages,
} from "@finesoft/core";
import type { SSRAppResult, SSRContext } from "./render";

interface InternalSSRFrameworkConfig extends FrameworkConfig {
    _resolvedMessages?: TranslationMessages;
}

/**
 * 哨兵 intent id —— 用来在 `serverData` 里夹带序列化的导航树。
 *
 * 取一个真实路由绝不会产出的保留 id（带 `@finesoft/` 前缀），因此不会与任何应用
 * intent 撞键；浏览器侧据此从预取数据中定位并剥除该条目。
 */
export const NAVIGATION_TREE_INTENT_ID = "@finesoft/navigation-tree";

/** 哨兵条目的 data 形态：序列化后的导航树 + 一个判别标记。 */
export interface SerializedNavigationTreePayload {
    /** 判别标记，配合 `NAVIGATION_TREE_INTENT_ID` 双重确认这是导航哨兵。 */
    readonly __finesoftNavigationTree: true;
    /** 序列化后的导航树（`deserializeNavigation` 可无损还原）。 */
    readonly tree: SerializedNavigation;
}

/**
 * 应用声明的导航结构（SSR 侧）。
 *
 * - `codec`：把 URL 解析为初始树（带 `__nav` 结构化覆盖时深链还原整棵树）。
 * - `initial`：可选的初始树工厂——codec 无覆盖、且应用想在无深链参数时也展示多区域骨架
 *   （如默认两列 split / 默认 tabs）时提供。不提供则回退「URL → 单 LeafNode」（今天的单页）。
 * - `beforeLoad` / `afterLoad`：目标级守卫，由控制器对主目标执行（叠加在全局/路由守卫外）。
 */
export interface SSRNavigationDefinition {
    /** URL ⇄ 树 的编解码器（调用方在 bootstrap 决定，缺省常用 `createActiveLeafCodec`）。 */
    readonly codec: NavigationCodec;
    /** 可选初始树工厂：codec 无法从 URL 还原结构时，用它产出默认结构骨架。 */
    readonly initial?: (url: string) => NavigationNode | undefined;
    /** 目标级 beforeLoad 守卫。 */
    readonly beforeLoad?: readonly BeforeLoadGuard[];
    /** 目标级 afterLoad 守卫。 */
    readonly afterLoad?: readonly AfterLoadGuard[];
}

/**
 * 导航 SSR 渲染选项。
 *
 * 在 `ssrRender` 的基础上多了一个必填 `navigation` 字段，承载应用声明的导航结构。
 * 其余字段语义与单页 SSR 完全一致。
 */
export interface SSRRenderNavigationOptions {
    /** 请求 URL */
    readonly url: string;
    /** Framework 配置（含路由注册等） */
    readonly frameworkConfig: FrameworkConfig;
    /** 注册 controllers 和路由的引导函数 */
    readonly bootstrap: (framework: Framework) => void;
    /** 获取错误页面 */
    readonly getErrorPage: (status: number, message: string) => BasePage;
    /**
     * 应用层渲染函数。
     *
     * 第一个参数是「主目标」页面（激活叶子的解析结果），与单页 SSR 的 `renderApp` 形态兼容；
     * 完整的多区域快照通过第三个参数 `snapshot` 传入，应用可据此渲染 tabs / split 等多区域布局。
     */
    readonly renderApp: (
        page: BasePage,
        framework: Framework,
        snapshot: NavigationSnapshot,
    ) => SSRAppResult | Promise<SSRAppResult>;
    /** 导航定义（codec + 目标级守卫 + 可选初始骨架）。 */
    readonly navigation: SSRNavigationDefinition;
    /** 可选的 SSR 请求上下文（如自定义 fetch） */
    readonly ssrContext?: SSRContext;
    /** 解析请求 locale 的回调（返回 lang + dir 用于 <html> 属性） */
    readonly resolveLocale?: (
        url: string,
        request?: Request,
    ) => { lang: string; dir: string } | undefined;
    /** 异步加载当前 locale 的翻译字典 */
    readonly loadMessages?: MessagesLoader;
}

/** 导航 SSR 渲染结果（在 `SSRRenderResult` 基础上附带最终导航快照）。 */
export interface SSRRenderNavigationResult {
    html: string;
    head: string;
    css: string;
    /** 每个可见目标一条 `{ intent, data: page }` + 一条导航树哨兵条目。 */
    serverData: PrefetchedIntent[];
    /** 主目标路由的渲染模式（由 Router 返回；多区域树默认 undefined → 服务端按 SSR 处理）。 */
    renderMode?: string;
    /** 中间件要求的重定向（服务端应返回 HTTP 301/302）。 */
    redirect?: { url: string; status: number };
    /** 自定义 slot 替换。 */
    slots?: Record<string, string>;
    /** 解析出的 locale 属性（用于 <html lang="" dir="">）。 */
    locale?: { lang: string; dir: string };
    /** 主目标 deny / dispatch 失败时的 HTTP 状态码（服务端据此设置 response status）。 */
    status?: number;
    /** 最终导航快照（树 + 所有可见目标解析结果）。 */
    snapshot: NavigationSnapshot;
}

/**
 * 渲染一棵结构化导航树的 SSR。
 *
 * 单 LeafNode 树 = 今天的扁平单页：一个可见目标，`serverData` 形如
 * `[{ intent, data: page }, <tree-sentinel>]`——比单页 SSR 仅多一条哨兵。
 */
export async function ssrRenderNavigation(
    options: SSRRenderNavigationOptions,
): Promise<SSRRenderNavigationResult> {
    const {
        url,
        frameworkConfig,
        bootstrap,
        getErrorPage,
        renderApp,
        navigation,
        ssrContext,
        resolveLocale,
        loadMessages,
    } = options;

    const parsed = new URL(url, "http://localhost");
    const fullPath = parsed.pathname + parsed.search;

    // locale 解析（与单页 SSR 一致：先解析 locale 再注入 DI 容器）。
    const resolvedLocale = resolveLocale?.(url, ssrContext?.request);
    const effectiveConfig: FrameworkConfig = resolvedLocale
        ? { ...frameworkConfig, locale: resolvedLocale.lang }
        : frameworkConfig;
    const resolvedMessages = await resolveConfiguredMessages({
        locale: effectiveConfig.locale,
        loadMessages,
        context: effectiveConfig.locale
            ? {
                  runtime: "server",
                  fetch: getSSRFetch(ssrContext?.fetch ?? effectiveConfig.fetch),
                  url: fullPath,
                  request: ssrContext?.request,
              }
            : undefined,
    });

    const mergedConfig: FrameworkConfig = {
        ...effectiveConfig,
        fetch: ssrContext?.fetch ?? effectiveConfig.fetch,
    };

    const framework = Framework.create({
        ...mergedConfig,
        _resolvedMessages: resolvedMessages,
    } as InternalSSRFrameworkConfig);
    bootstrap(framework);

    try {
        // ===== 1. URL → 初始树（单页回退时一并拿到该路由的 renderMode） =====
        const resolved = await resolveInitialTree(framework, navigation, fullPath);

        // 无任何匹配（codec 无覆盖 + 应用无 initial + Router 无匹配）→ 404 单页，
        // 与单页 SSR 的 404 路径对齐。
        if (resolved === undefined) {
            const page = getErrorPage(404, "Page not found");
            return renderResult({
                framework,
                resolvedLocale,
                renderApp,
                page,
                snapshot: { tree: leaf("@finesoft/not-found"), destinations: [] },
                serverData: [],
                renderMode: undefined,
                status: undefined,
            });
        }

        const { tree: initialTree, renderMode: fallbackRenderMode } = resolved;

        // CSR：单页回退命中 csr 路由 → 与单页 SSR 一致返回空壳（不预取、不渲染）。
        if (fallbackRenderMode === "csr") {
            return {
                html: "",
                head: "",
                css: "",
                serverData: [],
                renderMode: "csr",
                snapshot: { tree: initialTree, destinations: [] },
            };
        }

        // ===== 2. 构建 NavigationController + resolve 所有可见目标 =====
        let redirect: { url: string; status: number } | undefined;

        const controller = buildController({
            framework,
            navigation,
            initialTree,
            fullPath,
            request: ssrContext?.request,
            getErrorPage,
            onRedirect: (r) => {
                // 首个 redirect 胜出（与扁平 runner：beforeLoad redirect 立即短路一致）。
                redirect ??= r;
            },
        });

        const snapshot = await controller.resolve();

        // ===== 3. 主目标短路：redirect =====
        if (redirect !== undefined) {
            return {
                html: "",
                head: "",
                css: "",
                serverData: [],
                redirect,
                snapshot,
            };
        }

        // 主目标 = 激活叶子的解析结果；用于 renderApp 第一参数 + status。
        const primary = primaryDestination(snapshot, getErrorPage);

        return renderResult({
            framework,
            resolvedLocale,
            renderApp,
            page: primary.page,
            snapshot,
            serverData: buildServerData(snapshot),
            renderMode: fallbackRenderMode,
            status: primary.status,
        });
    } finally {
        framework.dispose();
    }
}

// =====================================================================
// 初始树解析
// =====================================================================

/** `resolveInitialTree` 的返回：初始树 +（单页回退时）该路由的 renderMode。 */
interface ResolvedInitialTree {
    readonly tree: NavigationNode;
    readonly renderMode: string | undefined;
}

/**
 * 从 URL 还原初始导航树：
 * 1. `codec.decode(url)` —— URL 带 `__nav` 等结构化覆盖时同步还原整棵树（深链）。
 * 2. 应用 `navigation.initial(url)` —— 无覆盖但应用想要默认结构骨架时。
 * 3. `Router.resolve(url)` → 单 LeafNode —— 今天的扁平单页回退（一并拿 renderMode）。
 * 全部失败（无匹配路由、无 initial、无覆盖）→ undefined（交由调用方 404）。
 *
 * 仅在第 3 步（真正的单 LeafNode 单页）回填 renderMode，保证单页路径的 renderMode 与今天
 * 完全一致；深链 / 多区域骨架走 SSR（renderMode = undefined）。
 */
async function resolveInitialTree(
    framework: Framework,
    navigation: SSRNavigationDefinition,
    url: string,
): Promise<ResolvedInitialTree | undefined> {
    // 1) 结构化覆盖（深链）：codec 同步还原整棵树。
    const decoded = navigation.codec.decode(url, framework.router);
    if (decoded !== undefined) return { tree: decoded, renderMode: undefined };

    // 2) 应用提供的默认结构骨架。
    const skeleton = navigation.initial?.(url);
    if (skeleton !== undefined) return { tree: skeleton, renderMode: undefined };

    // 3) 单页回退：Router.resolve → 单 LeafNode（今天的行为，含 renderMode）。
    const match = await framework.routeUrl(url);
    if (match === null) return undefined;
    return {
        tree: leaf(match.intent.id, (match.intent.params ?? {}) as Record<string, unknown>),
        renderMode: match.renderMode,
    };
}

// =====================================================================
// NavigationController 构建（SSR 侧上下文）
// =====================================================================

interface BuildControllerArgs {
    readonly framework: Framework;
    readonly navigation: SSRNavigationDefinition;
    readonly initialTree: NavigationNode;
    readonly fullPath: string;
    readonly request: Request | undefined;
    readonly getErrorPage: (status: number, message: string) => BasePage;
    readonly onRedirect: (redirect: { url: string; status: number }) => void;
}

/**
 * 构建 SSR 侧的 NavigationController。
 *
 * `createContext` 用 `createServerContext` 造守卫上下文（含请求 cookie/header），
 * Container 取自 framework——与单页 SSR runner 的 `createServerContext(...)` 完全同构。
 * 不传 `prefetched`：SSR 是「生产」预取数据的一侧，本身没有可复用的预取缓存。
 */
function buildController(args: BuildControllerArgs): NavigationController {
    const { framework, navigation, initialTree, fullPath, request, getErrorPage, onRedirect } =
        args;

    return createNavigationController({
        intentDispatcher: framework.intentDispatcher,
        router: framework.router,
        initial: initialTree,
        beforeLoad: navigation.beforeLoad,
        afterLoad: navigation.afterLoad,
        getErrorPage,
        onRedirect,
        createContext: ({ intent, params }): NavigationDispatchContext => ({
            container: framework.container,
            url: fullPath,
            navigation: createServerContext({
                url: fullPath,
                intent: { id: intent, params },
                container: framework.container,
                request,
            }),
        }),
    });
}

// =====================================================================
// 主目标 / serverData 组装
// =====================================================================

/** 取「主目标」解析结果：快照里与激活叶子同 intent+params 的那一条；缺省给兜底页。 */
function primaryDestination(
    snapshot: NavigationSnapshot,
    getErrorPage: (status: number, message: string) => BasePage,
): ResolvedDestination {
    const active = activeLeafIntent(snapshot.tree);
    if (active !== undefined) {
        const match = snapshot.destinations.find(
            (d) => d.intent === active.intent && sameParams(d.params, active.params),
        );
        if (match !== undefined) return match;
    }
    // 无激活叶子（空栈/空 split）或未命中：取第一个可见目标，再不行就兜底页。
    if (snapshot.destinations.length > 0) return snapshot.destinations[0];
    return {
        intent: "@finesoft/empty",
        params: {},
        page: getErrorPage(404, "Page not found"),
        status: 404,
    };
}

/** 激活叶子的 intent+params（沿可见分支下钻到末端叶子；空栈/空 split 时 undefined）。 */
function activeLeafIntent(
    tree: NavigationNode,
): { intent: string; params: Record<string, unknown> } | undefined {
    let node: NavigationNode = tree;
    for (;;) {
        switch (node.kind) {
            case "leaf":
                return { intent: node.intent, params: node.params };
            case "stack": {
                if (node.entries.length === 0) return undefined;
                node = node.entries[node.entries.length - 1];
                break;
            }
            case "tabs": {
                const branch = node.branches[node.active];
                if (branch === undefined) return undefined;
                node = branch;
                break;
            }
            case "split": {
                let last: NavigationNode | undefined;
                for (const col of node.columns) {
                    if (col.content !== undefined) last = col.content;
                }
                if (last === undefined) return undefined;
                node = last;
                break;
            }
        }
    }
}

function sameParams(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
        if (a[k] !== b[k]) return false;
    }
    return true;
}

/**
 * 把快照组装成 `serverData`：
 * - 每个可见目标 → `{ intent: { id, params }, data: page }`（与单页 SSR 完全一致）。
 * - 末尾追加 **导航树哨兵**：`{ intent: { id: NAVIGATION_TREE_INTENT_ID }, data: payload }`，
 *   `payload` 用 `markPublic(..., true)` 标记全字段公开，避免被 `serializeServerData`
 *   裁剪或触发未标注告警——它承载的是结构数据而非 page。
 */
function buildServerData(snapshot: NavigationSnapshot): PrefetchedIntent[] {
    const out: PrefetchedIntent[] = [];
    for (const dest of snapshot.destinations) {
        out.push({ intent: { id: dest.intent, params: dest.params }, data: dest.page });
    }
    out.push(navigationTreeSentinel(snapshot.tree));
    return out;
}

/** 构造承载序列化导航树的哨兵 `PrefetchedIntent`。 */
function navigationTreeSentinel(tree: NavigationNode): PrefetchedIntent {
    const payload: SerializedNavigationTreePayload = {
        __finesoftNavigationTree: true,
        tree: serializeNavigation(tree),
    };
    // markPublic 写的是非枚举 symbol，不进 JSON；标 true = 全字段透传，绕开白名单裁剪。
    return {
        intent: { id: NAVIGATION_TREE_INTENT_ID },
        data: markPublic(payload as unknown as BasePage, true),
    };
}

// =====================================================================
// 浏览器侧消费辅助（从预取数据中取出 / 剔除导航树哨兵）
// =====================================================================

/**
 * 从 `serverData`（或 hydration 数组）中取出导航树并反序列化。
 * 找不到哨兵 → undefined（应用未启用导航 / 单页路径）。畸形哨兵数据抛 NavigationError。
 */
export function extractNavigationTree(
    data: readonly PrefetchedIntent[],
): NavigationNode | undefined {
    for (const entry of data) {
        if (isNavigationTreeSentinel(entry)) {
            return deserializeNavigation(entry.data.tree);
        }
    }
    return undefined;
}

/**
 * 返回剔除导航树哨兵后的纯目标条目（供 `PrefetchedIntents.fromArray` 还原每个目标）。
 * 无哨兵时内容等价于原数组。
 */
export function stripNavigationTree(data: readonly PrefetchedIntent[]): PrefetchedIntent[] {
    return data.filter((entry) => !isNavigationTreeSentinel(entry));
}

/** 判别一条 PrefetchedIntent 是否为导航树哨兵（双重校验 id + 标记字段）。 */
function isNavigationTreeSentinel(
    entry: PrefetchedIntent,
): entry is PrefetchedIntent & { data: SerializedNavigationTreePayload } {
    if (entry.intent.id !== NAVIGATION_TREE_INTENT_ID) return false;
    const data = entry.data;
    return (
        typeof data === "object" &&
        data !== null &&
        (data as { __finesoftNavigationTree?: unknown }).__finesoftNavigationTree === true
    );
}

// =====================================================================
// 渲染结果组装 + SSR fetch（与单页 SSR 同语义）
// =====================================================================

interface RenderResultArgs {
    readonly framework: Framework;
    readonly resolvedLocale: { lang: string; dir: string } | undefined;
    readonly renderApp: (
        page: BasePage,
        framework: Framework,
        snapshot: NavigationSnapshot,
    ) => SSRAppResult | Promise<SSRAppResult>;
    readonly page: BasePage;
    readonly snapshot: NavigationSnapshot;
    readonly serverData: PrefetchedIntent[];
    readonly renderMode: string | undefined;
    readonly status: number | undefined;
}

async function renderResult(args: RenderResultArgs): Promise<SSRRenderNavigationResult> {
    const { framework, resolvedLocale, renderApp, page, snapshot, serverData, renderMode, status } =
        args;
    const result = await renderApp(page, framework, snapshot);
    const locale = resolvedLocale ?? framework.getLocale();
    return {
        html: result.html,
        head: result.head,
        css: result.css,
        serverData,
        renderMode,
        slots: result.slots,
        locale,
        status,
        snapshot,
    };
}

function getSSRFetch(fetchFn?: typeof globalThis.fetch): typeof globalThis.fetch {
    const resolvedFetch = fetchFn ?? globalThis.fetch?.bind(globalThis);
    if (resolvedFetch) {
        return resolvedFetch;
    }

    return (() => {
        throw new Error("[ssrRenderNavigation] loadMessages requires a fetch implementation.");
    }) as typeof globalThis.fetch;
}

// =====================================================================
// createSSRNavigationRender — 工厂（对齐 createSSRRender 的工效）
// =====================================================================

/** `createSSRNavigationRender` 的一次性配置（绑定后返回 `(url, ctx?) => result`）。 */
export interface SSRNavigationRenderConfig {
    /** 注册 controllers 和路由的引导函数 */
    readonly bootstrap: (framework: Framework) => void;
    /** 获取错误页面 */
    readonly getErrorPage: (status: number, message: string) => BasePage;
    /** 应用层渲染函数（含多区域快照） */
    readonly renderApp: (
        page: BasePage,
        framework: Framework,
        snapshot: NavigationSnapshot,
    ) => SSRAppResult | Promise<SSRAppResult>;
    /** 导航定义（codec + 目标级守卫 + 可选初始骨架） */
    readonly navigation: SSRNavigationDefinition;
    /** Framework 构造配置（可选） */
    readonly frameworkConfig?: FrameworkConfig;
    /** 解析请求 locale 的回调 */
    readonly resolveLocale?: (
        url: string,
        request?: Request,
    ) => { lang: string; dir: string } | undefined;
    /** 异步加载当前 locale 的翻译字典 */
    readonly loadMessages?: MessagesLoader;
}

/**
 * 创建导航 SSR render 函数。
 *
 * 把一次性配置（bootstrap / getErrorPage / renderApp / navigation）绑定后，返回
 * `(url, ssrContext?) => Promise<SSRRenderNavigationResult>`，与 `createSSRRender` 同形。
 */
export function createSSRNavigationRender(
    config: SSRNavigationRenderConfig,
): (url: string, ssrContext?: SSRContext) => Promise<SSRRenderNavigationResult> {
    const {
        bootstrap,
        getErrorPage,
        renderApp,
        navigation,
        frameworkConfig,
        resolveLocale,
        loadMessages,
    } = config;

    return (url: string, ssrContext?: SSRContext) =>
        ssrRenderNavigation({
            url,
            frameworkConfig: frameworkConfig ?? {},
            bootstrap,
            getErrorPage,
            renderApp,
            navigation,
            ssrContext,
            resolveLocale,
            loadMessages,
        });
}
