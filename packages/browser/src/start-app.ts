/**
 * startBrowserApp — 客户端 hydration 一站式启动
 *
 * 封装:
 * 1. PrefetchedIntents 从 DOM 提取
 * 2. Framework 创建 + 引导
 * 3. 应用层挂载（通过 mount 回调，框架无关）
 * 4. Action handlers 注册
 * 5. 初始页面触发
 */

import type {
    AfterLoadGuard,
    BasePage,
    BeforeLoadGuard,
    FrameworkConfig,
    Logger,
    MessagesLoader,
    NavigationCodec,
    NavigationController,
    NavigationNode,
    SessionSnapshot,
    SessionStateProvider,
    Storage,
    TranslationMessages,
} from "@finesoft/core";
import {
    createActiveLeafCodec,
    createBrowserContext,
    createNavigationController,
    createNavigationSessionAdapter,
    createSessionStore,
    createUrlSessionAdapter,
    DEP_KEYS,
    Framework,
    makeFlowAction,
    resolveConfiguredMessages,
    setHtmlLocaleAttributes,
    type LoggerFactory,
} from "@finesoft/core";
import { registerActionHandlers, type FlowActionCallbacks } from "./action-handlers/register";
import { createAppHandle, type AppHandle } from "./app-handle";
import { createDomRestore } from "./dom-restore";
import { activateFlatIslands, type ActivatedFlatIslands } from "./flat-islands";
import { createIslandOrchestrator, type MountEntry } from "./navigation-islands";
import { createNavigationBridge, type NavigationHandle } from "./navigation-bridge";
import { createPrefetchedIntentsFromDom } from "./server-data";
import { createSessionBridge, type SessionHandle } from "./session-bridge";
import { createWebStorage } from "./web-storage";

interface InternalBrowserFrameworkConfig extends FrameworkConfig {
    _resolvedMessages?: TranslationMessages;
}

/**
 * 结构化导航定义 —— 由应用通过 `defineNavigation(...)` 或手写提供。
 *
 * 仅当该字段出现时 bridge 才激活；缺省时 `startBrowserApp` 走原有扁平单页路径，行为不变。
 * 提供后：
 * - 用 `initial` 树构建 `NavigationController`（守卫上下文走 `createBrowserContext`，
 *   预取缓存复用 `framework.prefetchedIntents`）；
 * - 装配 `NavigationBridge`（snapshot → history/URL，popstate → hydrate）；
 * - 解析首屏树（一次 `resolve()`），通过 mount context 把 handle 交给应用。
 */
export interface BrowserNavigationConfig {
    /** 初始导航树（单 LeafNode = 今天的扁平单页）。 */
    readonly initial: NavigationNode;
    /** URL 编解码器；缺省 `createActiveLeafCodec()`。 */
    readonly codec?: NavigationCodec;
    /** 导航级 beforeLoad 守卫（对主目标执行）。 */
    readonly beforeLoad?: readonly BeforeLoadGuard[];
    /** 导航级 afterLoad 守卫。 */
    readonly afterLoad?: readonly AfterLoadGuard[];
    /** dispatch 失败 / deny 时的兜底错误页工厂。 */
    readonly getErrorPage?: (status: number, message: string) => BasePage;
    /**
     * opt-in islands 挂载原语：提供后框架按 per-entry 把视图挂为独立 root 并保活（见 Phase 2）。
     * 缺省时走原有「单 mount + 应用订阅 snapshot 重渲」路径，不变。
     */
    readonly mountEntry?: MountEntry;
}

/**
 * 会话恢复定义（可选）。
 *
 * 仅当该字段出现时会话能力才激活；缺省时 `startBrowserApp` 启动路径字节级不变。提供后：
 * - 构建 `SessionStore`（导航适配器：有 `navigation` 配置 → 结构化
 *   `createNavigationSessionAdapter(controller)`；否则 → 扁平 `createUrlSessionAdapter`
 *   接 `framework.perform(makeFlowAction(url))`）；
 * - 注册 `providers` 为全局切片来源；
 * - 装配 `SessionBridge`（导航变更防抖落盘 + `pagehide` / `visibilitychange` 即时落盘 + scoped prune）；
 * - mount 后 `restore(initialUrl)` 完成 boot 恢复，handle 经 mount context 交付。
 */
export interface BrowserSessionConfig {
    /** 全局状态切片 provider；启动时全部注册。 */
    readonly providers?: readonly SessionStateProvider[];
    /** 快照存储；缺省 `createWebStorage("session")`（标签级，关闭即清）。 */
    readonly storage?: Storage;
    /** 快照版本；缺省 `SESSION_DEFAULT_VERSION`，不符即整份丢弃。 */
    readonly version?: number;
    /** 快照最大存活时长（ms）；省略 = 不过期。 */
    readonly maxAgeMs?: number;
    /** 导航变更自动落盘防抖窗口（ms）；缺省 `SESSION_DEFAULT_DEBOUNCE_MS`。 */
    readonly debounceMs?: number;
    /** 恢复门控；缺省 `defaultShouldRestore`（显式深链优先）。 */
    readonly shouldRestore?: (snapshot: SessionSnapshot, currentUrl: string) => boolean;
}

export interface BrowserAppConfig {
    /** 注册 controllers 和路由的引导函数 */
    bootstrap: (framework: Framework) => void;

    /** DOM 挂载点 ID（默认 "app"） */
    mountId?: string;

    /** 获取可滚动页面元素，用于滚动位置保存/恢复 */
    getScrollablePageElement?: () => HTMLElement | null;

    /**
     * 启动前钩子 — 在 Framework 创建后、挂载前执行
     *
     * 用于初始化错误监控、埋点 SDK、i18n 等。
     */
    onBeforeStart?: (framework: Framework) => void | Promise<void>;

    /**
     * 启动后钩子 — 在初始页面触发后执行
     *
     * 用于启动后操作（如 service worker 注册、性能打点）。
     */
    onAfterStart?: (framework: Framework) => void | Promise<void>;

    /**
     * 挂载应用到 DOM
     *
     * 框架无关 — Svelte / React / Vue 均可通过此回调实现。
     *
     * @param target - DOM 挂载点
     * @param context - Framework 实例 + 语言 + handle（配了 navigation/session 时）
     * @returns 更新函数，用于后续页面切换
     */
    mount: (
        target: HTMLElement,
        context: {
            framework: Framework;
            navigation?: NavigationHandle;
            session?: SessionHandle;
            app?: AppHandle;
        },
    ) => (props: { page: Promise<BasePage> | BasePage; isFirstPage?: boolean }) => void;

    /** FlowAction / ExternalUrl 回调 */
    callbacks: FlowActionCallbacks;

    /**
     * Framework 配置 — locale、reportCallback、eventRecorder 等
     *
     * 传入后会在 Framework.create() 时合并。
     * prefetchedIntents 由框架自动从 DOM 提取，无需传入。
     */
    frameworkConfig?: Omit<import("@finesoft/core").FrameworkConfig, "prefetchedIntents">;

    /**
     * 异步加载当前 locale 的翻译字典。
     *
     * 显式传入时会覆盖 bootstrap / Vite 自动生成的 loader。
     */
    loadMessages?: MessagesLoader;

    /**
     * 结构化导航定义（可选）。
     *
     * 提供后，`startBrowserApp` 在 mount 前构建 NavigationController + NavigationBridge，
     * 并通过 mount context 把导航 handle 交给应用。缺省时走原有扁平单页路径，行为完全不变。
     */
    navigation?: BrowserNavigationConfig;

    /**
     * 会话恢复定义（可选）。
     *
     * 提供后，`startBrowserApp` 在 mount 前装配 `SessionStore` + `SessionBridge`，
     * 并通过 mount context 把会话 handle 交给应用；boot 恢复（restore）在 mount 后执行。
     * 缺省时整段不生效，启动路径字节级不变。
     */
    session?: BrowserSessionConfig;

    /**
     * opt-in 重载 DOM 自动恢复（spec §4.5）。仅当同时提供 `navigation.mountEntry`（islands）+
     * `session` 时生效：标 `data-restore-root` 的容器内表单/滚动/<details> 自动捕获进会话作用域、
     * 重载后回填。缺省关闭。
     */
    domRestore?: boolean;

    /**
     * 顶层 islands 挂载原语（flat-islands opt-in，Phase 4）。
     *
     * 提供此字段且**未提供** `navigation` 时，框架合成一个隐式单栈 `NavigationController`，
     * 把 `FlowAction` 正向导航路由为 `controller.push`，`popstate` 路由为 `hydrate`，
     * island 实例在 back/forward 时保活不重挂。
     *
     * 提供了 `navigation` 时请使用 `navigation.mountEntry`，顶层该字段被忽略。
     */
    mountEntry?: MountEntry;
}

/**
 * 启动客户端应用
 *
 * 自动执行 hydration 全流程。
 */
export async function startBrowserApp(config: BrowserAppConfig): Promise<void> {
    const {
        bootstrap,
        mountId = "app",
        mount,
        callbacks,
        onBeforeStart,
        onAfterStart,
        frameworkConfig = {},
        loadMessages,
    } = config;

    // 1. 从 DOM 提取 PrefetchedIntents 缓存
    const prefetchedIntents = createPrefetchedIntentsFromDom();

    const initialUrl = window.location.pathname + window.location.search;
    const locale = resolveBrowserLocale(frameworkConfig.locale);
    const resolvedMessages = await resolveConfiguredMessages({
        locale,
        loadMessages,
        context: locale
            ? {
                  runtime: "browser",
                  fetch: getBrowserFetch(frameworkConfig.fetch),
                  url: initialUrl,
              }
            : undefined,
    });

    // 2. 初始化 Framework + 注册 Controllers
    const framework = Framework.create({
        ...frameworkConfig,
        locale,
        _resolvedMessages: resolvedMessages,
        prefetchedIntents,
    } as InternalBrowserFrameworkConfig);
    bootstrap(framework);

    const loggerFactory = framework.container.resolve<LoggerFactory>(DEP_KEYS.LOGGER_FACTORY);
    const log: Logger = loggerFactory.loggerFor("browser");

    // 2.5 应用 locale 到 <html> 元素
    const resolvedLocale = framework.getLocale();
    if (resolvedLocale) {
        setHtmlLocaleAttributes(resolvedLocale);
        log.debug("[startBrowserApp] Applied locale attributes:", resolvedLocale);
    }

    // 2.6 启动前钩子
    await onBeforeStart?.(framework);

    // 3. 路由初始 URL
    const initialAction = await framework.routeUrl(initialUrl);

    // 4. 挂载点校验（早于 nav/session core，让错误尽早暴露）
    const target = document.getElementById(mountId);
    if (!target) {
        throw new Error(
            `[startBrowserApp] Mount target not found: #${mountId}. ` +
                `Ensure your HTML has <div id="${mountId}"></div>.`,
        );
    }

    // 5. 【mount 前】nav-core：建 controller/bridge（handle 就绪；此刻 getSnapshot = {tree, []}）
    let navCore: NavigationCore | undefined;
    if (config.navigation) {
        navCore = await activateNavigationCore({
            framework,
            navigation: config.navigation,
            log,
            getScrollablePageElement: config.getScrollablePageElement,
        });
    }

    // 6. 【mount 前】flatNavigation 发射器（真扁平 session 用）+ session-core（建 store/bridge，不 restore）
    //    「真扁平」会话（有 session、无 navigation、无 mountEntry）需要一个导航变更信号驱动自动落盘
    //    + scoped prune。唯一的扁平导航信号是 FlowAction handler 提交后调用的 `callbacks.onNavigate`，
    //    故把它 tee 给会话监听器。仅在该场景包装 callbacks；其余情形透传原对象，启动路径字节级不变。
    //    flat-islands（有 mountEntry）的正向导航 **bypass** callbacks.onNavigate（走隐式单栈
    //    controller.push），onNavigate tee 收不到信号；故 flat-islands 不创建 flatNavigation，
    //    会话改订阅 islands controller 的快照（见 activateSessionCore）。
    const flatNavigation =
        config.session && !config.navigation && !config.mountEntry
            ? createNavigationEmitter()
            : undefined;

    let sessionHandle: SessionHandle | undefined;
    if (config.session) {
        sessionHandle = activateSessionCore({
            framework,
            session: config.session,
            navController: navCore?.controller,
            flatNavigation,
        });
    }

    // 7. 【mount 前】建统一 app 句柄
    const app =
        navCore !== undefined || sessionHandle !== undefined
            ? createAppHandle(navCore?.handle, sessionHandle)
            : undefined;

    // 8. 【mount】context 交付 handle/app
    const updateApp = mount(target, {
        framework,
        navigation: navCore?.handle,
        session: sessionHandle,
        app,
    });

    // 9. 注册 action handlers（需 updateApp）
    //    flat-islands：deferred-ref，由下方 activateFlatIslands 填充后供 onForward 使用。
    //    onForward 本身在 registerActionHandlers 调用时就已绑定（闭包捕获 ref），
    //    而 flatPush 在 activateFlatIslands 完成后才非 undefined——这是正确的：
    //    onForward 只会在用户触发 FlowAction 时调用，彼时启动流程早已完成。
    let flatPush: ((url: string) => Promise<void>) | undefined;

    registerActionHandlers({
        framework,
        log,
        callbacks: flatNavigation ? flatNavigation.wrap(callbacks) : callbacks,
        updateApp,
        getScrollablePageElement: config.getScrollablePageElement,
        // 结构化导航 + flat-islands 下 history 由 NavigationBridge 独占；
        // 否则两套 History 争抢 window.history.state。
        manageHistory: !(config.navigation || config.mountEntry),
        // flat-islands：正向 FlowAction 路由到隐式单栈 controller.push（bypass navigateTo）。
        onForward: config.mountEntry && !config.navigation ? (url) => flatPush?.(url) : undefined,
    });

    // 10. flat-islands 激活（可选）—— 合成隐式单栈 + 编排器 + 首屏 island。
    //     必须在 registerActionHandlers 之后（handler 已注册，action 可 dispatch），
    //     在 step-11 perform 之前（避免双重渲染）。
    let activatedFlatIslands: ActivatedFlatIslands | undefined;
    if (config.mountEntry && !config.navigation) {
        activatedFlatIslands = await activateFlatIslands({
            framework,
            initialUrl,
            mountEntry: config.mountEntry,
            target,
            log,
            getScrollablePageElement: config.getScrollablePageElement,
        });
        // 用实际的 pushUrl 填充 deferred-ref，之后 onForward 就能用了。
        flatPush = activatedFlatIslands.pushUrl;
    }

    // 11. 首屏触发
    //     flat-islands 下首屏已由 activateFlatIslands 内的 controller.resolve() 完成；
    //     跳过 framework.perform 避免双重渲染。
    //     结构化导航（navCore）走 attachNavigation（resolve + islands 装配，均在 mount 后）。
    let islandsOutlet: HTMLElement | undefined;
    if (navCore !== undefined) {
        const { outlet } = await attachNavigation({ core: navCore, target });
        islandsOutlet = outlet;
    } else if (activatedFlatIslands === undefined) {
        if (initialAction) {
            await framework.perform(initialAction.action);
        } else {
            updateApp({
                page: Promise.reject(new Error("404")),
                isFirstPage: true,
            });
        }
    }
    islandsOutlet ??= activatedFlatIslands?.outlet;

    // 12. 会话 boot 恢复（mount 后：保 SSR 水合 parity）
    if (sessionHandle !== undefined) await sessionHandle.restore(initialUrl);

    // 13. 重载 DOM 自动恢复（opt-in）—— 需 islands outlet + session scope。
    //     attach 在会话已恢复 scope（12）之后运行，内部 catch-up 回填 boot DOM。
    //     支持结构化导航（islandsOutlet via attachNavigation）和 flat-islands（activatedFlatIslands.outlet）。
    if (config.domRestore && islandsOutlet && sessionHandle !== undefined) {
        createDomRestore({ scope: sessionHandle.scope }).attach(islandsOutlet);
    }

    // 14. 启动后钩子
    await onAfterStart?.(framework);
}

/** nav-core 建出的中间结构（mount 前就绪）。 */
interface NavigationCore {
    readonly handle: NavigationHandle;
    readonly controller: NavigationController;
    readonly mountEntry?: MountEntry;
}

/**
 * mount 前：建 NavigationController + NavigationBridge（handle 就绪；此刻 getSnapshot = {tree, []}）。
 * 不在此 resolve()、不建 orchestrator —— 均移到 mount 后（attachNavigation）。
 */
async function activateNavigationCore(args: {
    framework: Framework;
    navigation: BrowserNavigationConfig;
    log: Logger;
    getScrollablePageElement?: () => HTMLElement | null;
}): Promise<NavigationCore> {
    const { framework, navigation, log, getScrollablePageElement } = args;
    const codec = navigation.codec ?? createActiveLeafCodec();

    const controller = createNavigationController({
        intentDispatcher: framework.intentDispatcher,
        router: framework.router,
        initial: navigation.initial,
        // 守卫上下文走 createBrowserContext（与 FlowAction handler 一致：读 document.cookie）。
        createContext: ({ intent, params }) => {
            const url = codec.encode({ kind: "leaf", intent, params }, framework.router);
            return {
                container: framework.container,
                navigation: createBrowserContext({
                    url,
                    intent: { id: intent, params },
                    container: framework.container,
                }),
                url,
            };
        },
        beforeLoad: navigation.beforeLoad,
        afterLoad: navigation.afterLoad,
        // 浏览器 hydration：复用 SSR 预取的可见目标结果。
        prefetched: framework.prefetchedIntents,
        getErrorPage: navigation.getErrorPage,
        // redirect → SPA 内跳，复用现有 FlowAction 管线。
        onRedirect: ({ url }) => {
            void framework.perform(makeFlowAction(url));
        },
    });

    const handle = createNavigationBridge({
        controller,
        codec,
        router: framework.router,
        log,
        getScrollablePageElement,
    });

    // 注意：不在此 resolve()、不建 orchestrator —— 均移到 mount 后（attachNavigation）。
    return { handle, controller, mountEntry: navigation.mountEntry };
}

/**
 * mount 后：resolve 首屏 + （若有 mountEntry）从 outlet 建 orchestrator 首次 sync。
 * 返回 outlet（供 domRestore）。
 *
 * resolve() 出 pages；redirect→perform 此刻安全（registerActionHandlers 已注册）。
 */
async function attachNavigation(args: {
    core: NavigationCore;
    target: HTMLElement;
}): Promise<{ outlet?: HTMLElement }> {
    const { core, target } = args;
    await core.controller.resolve();

    if (core.mountEntry === undefined) return {};

    const found = target.querySelector<HTMLElement>("[data-fs-outlet]");
    if (!found) {
        throw new Error(
            "[startBrowserApp] navigation.mountEntry 已提供，但 mount 渲染的 DOM 里找不到 [data-fs-outlet]。" +
                "请在 chrome 里放一个稳定、空的 <main data-fs-outlet></main>。",
        );
    }

    const orchestrator = createIslandOrchestrator({
        outlet: found,
        mountEntry: core.mountEntry,
    });
    orchestrator.sync(core.controller.getSnapshot());
    // 订阅与 orchestrator 的生命周期绑定到页面（同 NavigationBridge，无需 teardown）。
    core.controller.subscribe((snapshot) => orchestrator.sync(snapshot));

    return { outlet: found };
}

/** 扁平导航变更发射器：tee `FlowActionCallbacks.onNavigate` 给会话监听器。 */
interface FlatNavigationEmitter {
    /** 包装一份 callbacks：`onNavigate` 先调原回调，再广播给监听器。 */
    wrap(callbacks: FlowActionCallbacks): FlowActionCallbacks;
    /** 订阅导航变更；返回反订阅函数（形态对齐 `SessionBridgeOptions.subscribeNavigation`）。 */
    subscribe(onChange: () => void): () => void;
}

/**
 * 创建扁平导航变更发射器。
 *
 * 扁平单页没有 NavigationController，唯一可观测的「导航已提交」信号是 FlowAction handler
 * 在落 history 后调用的 `callbacks.onNavigate(pathname)`。会话需要这个信号来防抖落盘并 prune
 * 离屏作用域，故把它 tee 出来：`wrap` 出的 callbacks 透明转发原回调，额外广播给监听器。
 */
function createNavigationEmitter(): FlatNavigationEmitter {
    const listeners = new Set<() => void>();
    return {
        wrap(cbs: FlowActionCallbacks): FlowActionCallbacks {
            return {
                ...cbs,
                onNavigate(pathname: string): void {
                    cbs.onNavigate(pathname);
                    for (const listener of listeners) listener();
                },
            };
        },
        subscribe(onChange: () => void): () => void {
            listeners.add(onChange);
            return () => {
                listeners.delete(onChange);
            };
        },
    };
}

/**
 * mount 前：装配 SessionStore + SessionBridge，注册 providers。不调 restore。
 * restore 留在 mount 后（保 SSR 水合 parity）。
 *
 * 导航适配器二选一：
 * - **有 NavigationController**（结构化 `navigation` 或 flat-islands `flatIslands`）→
 *   `createNavigationSessionAdapter(controller)`：捕获整棵树、`presentKeys` 收全部 leaf（含
 *   保活的栈底）供 scoped prune；导航变更经该 controller 的 `subscribe` 订阅。
 * - **真扁平**（无 controller）→ `createUrlSessionAdapter`：`apply` 走
 *   `framework.perform(makeFlowAction(url))`，导航变更经 `flatNavigation.subscribe`
 *   （tee 自 `callbacks.onNavigate`）订阅。
 *
 * flat-islands 走第一条：它的正向导航 bypass `callbacks.onNavigate`，URL 适配器的单条目
 * `presentKeys` 也会误 prune 掉保活的栈内条目，故必须用结构化适配器 + controller 快照信号。
 *
 * 注意：flat-islands 的 controller 在 activateFlatIslands（mount 后）建，session-core 跑在 mount 前，
 * 此时 navController 尚无 flat-islands controller —— flat-islands+session 是未用组合，
 * 无 navController 时退 flatNavigation 保持已有行为即可，不为它额外加工。
 */
function activateSessionCore(args: {
    framework: Framework;
    session: BrowserSessionConfig;
    navController: NavigationController | undefined;
    flatNavigation: FlatNavigationEmitter | undefined;
}): SessionHandle {
    const { framework, session, navController, flatNavigation } = args;

    const currentUrl = (): string => window.location.pathname + window.location.search;
    const adapter = navController
        ? createNavigationSessionAdapter(navController, currentUrl)
        : createUrlSessionAdapter({
              currentUrl,
              navigate: (url) => framework.perform(makeFlowAction(url)),
          });

    const subscribeNavigation = navController
        ? (onChange: () => void): (() => void) => navController.subscribe(() => onChange())
        : flatNavigation
          ? (onChange: () => void): (() => void) => flatNavigation.subscribe(onChange)
          : undefined;

    const store = createSessionStore({
        storage: session.storage ?? createWebStorage("session"),
        navigation: adapter,
        version: session.version,
        maxAgeMs: session.maxAgeMs,
    });

    for (const provider of session.providers ?? []) {
        store.register(provider);
    }

    return createSessionBridge({
        store,
        adapter,
        subscribeNavigation,
        debounceMs: session.debounceMs,
        shouldRestore: session.shouldRestore,
    });
}

function resolveBrowserLocale(locale?: string): string | undefined {
    if (locale) {
        return locale;
    }

    const documentLocale = document.documentElement.lang.trim();
    return documentLocale || undefined;
}

function getBrowserFetch(fetchFn?: typeof globalThis.fetch): typeof globalThis.fetch {
    const resolvedFetch = fetchFn ?? globalThis.fetch?.bind(globalThis);
    if (resolvedFetch) {
        return resolvedFetch;
    }

    return (() => {
        throw new Error("[startBrowserApp] loadMessages requires a fetch implementation.");
    }) as typeof globalThis.fetch;
}
