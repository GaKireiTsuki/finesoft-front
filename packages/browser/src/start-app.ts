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

import type { BasePage, Logger } from "@finesoft/core";
import { DEP_KEYS, Framework, type LoggerFactory } from "@finesoft/core";
import { registerActionHandlers, type FlowActionCallbacks } from "./action-handlers/register";
import { createPrefetchedIntentsFromDom } from "./server-data";

export interface BrowserAppConfig {
    /** 注册 controllers 和路由的引导函数 */
    bootstrap: (framework: Framework) => void;

    /** 默认语言（回退值） */
    defaultLocale?: string;

    /** DOM 挂载点 ID（默认 "app"） */
    mountId?: string;

    /** 获取可滚动页面元素，用于滚动位置保存/恢复 */
    getScrollablePageElement?: () => HTMLElement | null;

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
        context: { framework: Framework; locale: string },
    ) => (props: { page: Promise<BasePage> | BasePage; isFirstPage?: boolean }) => void;

    /** FlowAction / ExternalUrl 回调 */
    callbacks: FlowActionCallbacks;
}

/**
 * 启动客户端应用
 *
 * 自动执行 hydration 全流程。
 */
export async function startBrowserApp(config: BrowserAppConfig): Promise<void> {
    const { bootstrap, defaultLocale = "en", mountId = "app", mount, callbacks } = config;

    // 1. 从 DOM 提取 PrefetchedIntents 缓存
    const prefetchedIntents = createPrefetchedIntentsFromDom();

    // 2. 初始化 Framework + 注册 Controllers
    const framework = Framework.create({ prefetchedIntents });
    bootstrap(framework);

    const loggerFactory = framework.container.resolve<LoggerFactory>(DEP_KEYS.LOGGER_FACTORY);
    const log: Logger = loggerFactory.loggerFor("browser");

    // 3. 路由初始 URL
    const initialAction = framework.routeUrl(window.location.pathname + window.location.search);

    // 4. 挂载应用（框架无关）
    const locale = document.documentElement.lang || defaultLocale;
    const target = document.getElementById(mountId)!;
    const updateApp = mount(target, { framework, locale });

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
}
