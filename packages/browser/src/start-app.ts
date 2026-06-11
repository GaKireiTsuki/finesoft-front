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
 * - 解析首屏树（一次 `resolve()`），通过 `onNavigationReady` 把 handle 交给应用。
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
 * - 首次导航后 `restore(initialUrl)` 完成 boot 恢复，并把 handle 交给 `onSessionReady`。
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
     * @param context - Framework 实例 + 语言
     * @returns 更新函数，用于后续页面切换
     */
    mount: (
        target: HTMLElement,
        context: { framework: Framework },
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
     * 提供后，`startBrowserApp` 在挂载后构建 NavigationController + NavigationBridge，
     * 解析首屏树，并通过 `onNavigationReady` 把导航 handle 交给应用。缺省时走原有
     * 扁平单页路径（FlowAction handler），行为完全不变。
     */
    navigation?: BrowserNavigationConfig;

    /**
     * 导航就绪回调 —— bridge 装配并完成首屏 `resolve()` 后调用。
     *
     * 仅当提供了 `navigation` 时触发。应用拿到 handle 后用它驱动导航
     * （push/pop/selectTab…）并订阅快照渲染 UI。
     */
    onNavigationReady?: (handle: NavigationHandle) => void | Promise<void>;

    /**
     * 会话恢复定义（可选）。
     *
     * 提供后，`startBrowserApp` 在首次导航后装配 `SessionStore` + `SessionBridge`，
     * 完成 boot 恢复，并通过 `onSessionReady` 把会话 handle 交给应用。缺省时整段不生效，
     * 启动路径字节级不变。
     */
    session?: BrowserSessionConfig;

    /**
     * 会话就绪回调 —— bridge 装配并完成 boot 恢复后调用。
     *
     * 仅当提供了 `session` 时触发。应用拿到 handle 后可用 `save()` / `clear()` 手动控制
     * 落盘，或在卸载时 `dispose()`。
     */
    onSessionReady?: (handle: SessionHandle) => void | Promise<void>;

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

    // 4. 挂载应用（框架无关）
    const target = document.getElementById(mountId);
    if (!target) {
        throw new Error(
            `[startBrowserApp] Mount target not found: #${mountId}. ` +
                `Ensure your HTML has <div id="${mountId}"></div>.`,
        );
    }
    const updateApp = mount(target, { framework });

    // 5. 注册 Action Handlers
    //    扁平会话（有 session、无 navigation）需要一个导航变更信号驱动自动落盘 + scoped prune。
    //    唯一的扁平导航信号是 FlowAction handler 提交后调用的 `callbacks.onNavigate`，故把它 tee
    //    给会话监听器。仅在该场景包装 callbacks；其余情形透传原对象，启动路径字节级不变。
    const flatNavigation =
        config.session && !config.navigation ? createNavigationEmitter() : undefined;

    // flat-islands：deferred-ref，由下方 activateFlatIslands 填充后供 onForward 使用。
    // onForward 本身在 registerActionHandlers 调用时就已绑定（闭包捕获 ref），
    // 而 flatPush 在 activateFlatIslands 完成后才非 undefined——这是正确的：
    // onForward 只会在用户触发 FlowAction 时调用，彼时启动流程早已完成。
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

    // 5.5 flat-islands 激活（可选）—— 合成隐式单栈 + 编排器 + 首屏 island。
    //     必须在 registerActionHandlers 之后（handler 已注册，action 可 dispatch），
    //     在 step-6 perform 之前（避免双重渲染）。
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

    // 6. 触发初始页面
    //    flat-islands 下首屏已由 activateFlatIslands 内的 controller.resolve() 完成；
    //    跳过 framework.perform 避免双重渲染。
    //    结构化导航（config.navigation）不跳过：step-6 仍需驱动 updateApp 初始渲染（flat UI
    //    side），activateNavigation 的 resolve() 是独立的 islands 通道，两者互不干扰。
    if (!activatedFlatIslands) {
        if (initialAction) {
            await framework.perform(initialAction.action);
        } else {
            updateApp({
                page: Promise.reject(new Error("404")),
                isFirstPage: true,
            });
        }
    }

    // 6.5 结构化导航（可选）—— 仅当应用提供 navigation 定义时激活，
    // 否则上面的扁平单页路径已是全部行为。
    let activatedNavigation: ActivatedNavigation | undefined;
    if (config.navigation) {
        activatedNavigation = await activateNavigation({
            framework,
            navigation: config.navigation,
            log,
            target,
            getScrollablePageElement: config.getScrollablePageElement,
        });
        await config.onNavigationReady?.(activatedNavigation.handle);
    }

    // 6.7 会话恢复（可选）—— 仅当应用提供 session 定义时激活，缺省整段不生效。
    let sessionHandle: SessionHandle | undefined;
    if (config.session) {
        sessionHandle = await activateSession({
            framework,
            session: config.session,
            navigation: activatedNavigation,
            flatNavigation,
            initialUrl,
        });
        await config.onSessionReady?.(sessionHandle);
    }

    // 6.8 重载 DOM 自动恢复（opt-in）—— 需 islands outlet + session scope。
    // attach 在会话已恢复 scope（6.7）之后运行，内部 catch-up 回填 boot DOM。
    // 支持结构化导航（activatedNavigation.outlet）和 flat-islands（activatedFlatIslands.outlet）。
    const islandsOutlet = activatedNavigation?.outlet ?? activatedFlatIslands?.outlet;
    if (config.domRestore && islandsOutlet && sessionHandle) {
        createDomRestore({ scope: sessionHandle.scope }).attach(islandsOutlet);
    }

    // 7. 启动后钩子
    await onAfterStart?.(framework);
}

/** 已激活的结构化导航：对外 handle + 内部 controller（供会话结构化适配器引用）。 */
interface ActivatedNavigation {
    readonly handle: NavigationHandle;
    readonly controller: NavigationController;
    /** islands の outlet（仅 mountEntry 提供时存在，供 domRestore 接线）。 */
    readonly outlet?: HTMLElement;
}

/** 装配 NavigationController + NavigationBridge，解析首屏树，返回导航 handle + controller。 */
async function activateNavigation(args: {
    framework: Framework;
    navigation: BrowserNavigationConfig;
    log: Logger;
    target: HTMLElement;
    getScrollablePageElement?: () => HTMLElement | null;
}): Promise<ActivatedNavigation> {
    const { framework, navigation, log, target, getScrollablePageElement } = args;
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

    // 首屏解析：提交首个快照（bridge 用 replaceState 写入 history，不污染历史栈）。
    await controller.resolve();

    // opt-in islands：从 outlet 建编排器，首同步 + 订阅后续快照。
    let outlet: HTMLElement | undefined;
    if (navigation.mountEntry) {
        const found = target.querySelector<HTMLElement>("[data-fs-outlet]");
        if (!found) {
            throw new Error(
                "[startBrowserApp] navigation.mountEntry 已提供，但 mount 渲染的 DOM 里找不到 [data-fs-outlet]。" +
                    "请在 chrome 里放一个稳定、空的 <main data-fs-outlet></main>。",
            );
        }
        outlet = found;
        const orchestrator = createIslandOrchestrator({
            outlet,
            mountEntry: navigation.mountEntry,
        });
        orchestrator.sync(controller.getSnapshot());
        // 订阅与 orchestrator 的生命周期绑定到页面（同 NavigationBridge，无需 teardown）。
        controller.subscribe((snapshot) => orchestrator.sync(snapshot));
    }

    return { handle, controller, outlet };
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
        wrap(callbacks: FlowActionCallbacks): FlowActionCallbacks {
            return {
                ...callbacks,
                onNavigate(pathname: string): void {
                    callbacks.onNavigate(pathname);
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
 * 装配 SessionStore + SessionBridge，注册 providers，完成 boot 恢复，返回会话 handle。
 *
 * 导航适配器二选一：结构化（有 `navigation` 激活）→ `createNavigationSessionAdapter(controller)`，
 * 导航变更经 `handle.subscribe` 订阅；扁平 → `createUrlSessionAdapter`，`apply` 走
 * `framework.perform(makeFlowAction(url))`，导航变更经 `flatNavigation.subscribe`（tee 自
 * `callbacks.onNavigate`）订阅。
 */
async function activateSession(args: {
    framework: Framework;
    session: BrowserSessionConfig;
    navigation: ActivatedNavigation | undefined;
    flatNavigation: FlatNavigationEmitter | undefined;
    initialUrl: string;
}): Promise<SessionHandle> {
    const { framework, session, navigation, flatNavigation, initialUrl } = args;

    const currentUrl = (): string => window.location.pathname + window.location.search;
    const adapter = navigation
        ? createNavigationSessionAdapter(navigation.controller, currentUrl)
        : createUrlSessionAdapter({
              currentUrl,
              navigate: (url) => framework.perform(makeFlowAction(url)),
          });

    const subscribeNavigation = navigation
        ? (onChange: () => void): (() => void) => navigation.handle.subscribe(() => onChange())
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

    const bridge = createSessionBridge({
        store,
        adapter,
        subscribeNavigation,
        debounceMs: session.debounceMs,
        shouldRestore: session.shouldRestore,
    });

    // boot 恢复：首次导航已在上面完成，此处读快照并按门控整体应用（nav + slices）。
    await bridge.restore(initialUrl);

    return bridge;
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
