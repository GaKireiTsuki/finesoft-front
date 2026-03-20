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
    BasePage,
    FrameworkConfig,
    Logger,
    MessagesLoader,
    TranslationMessages,
} from "@finesoft/core";
import {
    DEP_KEYS,
    Framework,
    resolveConfiguredMessages,
    setHtmlLocaleAttributes,
    type LoggerFactory,
} from "@finesoft/core";
import { registerActionHandlers, type FlowActionCallbacks } from "./action-handlers/register";
import { createPrefetchedIntentsFromDom } from "./server-data";

interface InternalBrowserFrameworkConfig extends FrameworkConfig {
    _resolvedMessages?: TranslationMessages;
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
    const initialAction = framework.routeUrl(initialUrl);

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

    // 7. 启动后钩子
    await onAfterStart?.(framework);
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
