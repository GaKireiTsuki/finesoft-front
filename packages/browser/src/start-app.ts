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
    NavigationNode,
    TranslationMessages,
} from "@finesoft/core";
import {
    createActiveLeafCodec,
    createBrowserContext,
    createNavigationController,
    DEP_KEYS,
    Framework,
    makeFlowAction,
    resolveConfiguredMessages,
    setHtmlLocaleAttributes,
    type LoggerFactory,
} from "@finesoft/core";
import { registerActionHandlers, type FlowActionCallbacks } from "./action-handlers/register";
import { createNavigationBridge, type NavigationHandle } from "./navigation-bridge";
import { createPrefetchedIntentsFromDom } from "./server-data";

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
    registerActionHandlers({
        framework,
        log,
        callbacks,
        updateApp,
        getScrollablePageElement: config.getScrollablePageElement,
        // 结构化导航下 history 由 NavigationBridge 独占；否则两套 History 争抢 window.history.state。
        manageHistory: !config.navigation,
    });

    // 6. 触发初始页面
    if (initialAction) {
        await framework.perform(initialAction.action);
    } else {
        updateApp({
            page: Promise.reject(new Error("404")),
            isFirstPage: true,
        });
    }

    // 6.5 结构化导航（可选）—— 仅当应用提供 navigation 定义时激活，
    // 否则上面的扁平单页路径已是全部行为。
    if (config.navigation) {
        const handle = await activateNavigation({
            framework,
            navigation: config.navigation,
            log,
            getScrollablePageElement: config.getScrollablePageElement,
        });
        await config.onNavigationReady?.(handle);
    }

    // 7. 启动后钩子
    await onAfterStart?.(framework);
}

/** 装配 NavigationController + NavigationBridge，解析首屏树，返回导航 handle。 */
async function activateNavigation(args: {
    framework: Framework;
    navigation: BrowserNavigationConfig;
    log: Logger;
    getScrollablePageElement?: () => HTMLElement | null;
}): Promise<NavigationHandle> {
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

    // 首屏解析：提交首个快照（bridge 用 replaceState 写入 history，不污染历史栈）。
    await controller.resolve();

    return handle;
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
