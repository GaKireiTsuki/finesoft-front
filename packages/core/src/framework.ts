/**
 * Framework — 框架核心类
 *
 * 对应原版 Jet 类，统一管理: DI 容器、Intent 分发、Action 分发、路由、Metrics。
 * 纯 TypeScript，不依赖任何 UI 框架。
 */

import { ActionDispatcher, type ActionHandler } from "./actions/dispatcher";
import type { Action } from "./actions/types";
import { Container } from "./dependencies/container";
import type { MetricsRecorder } from "./dependencies/make-dependencies";
import {
    DEP_KEYS,
    makeDependencies,
    type MakeDependenciesOptions,
} from "./dependencies/make-dependencies";
import type { LocaleAttributes } from "./i18n/types";
import { IntentDispatcher } from "./intents/dispatcher";
import type { Intent, IntentController } from "./intents/types";
import type { Logger } from "./logger/types";
import { runAfterLoadGuards, runBeforeLoadGuards } from "./middleware/pipeline";
import type {
    AfterLoadGuard,
    BeforeLoadGuard,
    MiddlewareResult,
    NavigationContext,
    PostLoadContext,
} from "./middleware/types";
import type { BasePage } from "./models/page";
import { PrefetchedIntents } from "./prefetched-intents/prefetched-intents";
import { Router, type RouteMatch } from "./router/router";
import type { PlatformInfo } from "./utils/platform";

/** Framework 初始化配置 */
export interface FrameworkConfig extends MakeDependenciesOptions {
    setupRoutes?: (router: Router) => void;
    prefetchedIntents?: PrefetchedIntents;
}

export class Framework {
    readonly container: Container;
    readonly intentDispatcher: IntentDispatcher;
    readonly actionDispatcher: ActionDispatcher;
    readonly router: Router;
    readonly prefetchedIntents: PrefetchedIntents;

    private readonly beforeGuards: BeforeLoadGuard[] = [];
    private readonly afterGuards: AfterLoadGuard[] = [];
    private _logger?: Logger;

    private constructor(container: Container, prefetchedIntents: PrefetchedIntents) {
        this.container = container;
        this.intentDispatcher = new IntentDispatcher();
        this.actionDispatcher = new ActionDispatcher();
        this.router = new Router();
        this.prefetchedIntents = prefetchedIntents;
    }

    /** 创建并初始化 Framework 实例 */
    static create(config: FrameworkConfig = {}): Framework {
        const container = new Container();
        makeDependencies(container, config);

        const fw = new Framework(container, config.prefetchedIntents ?? PrefetchedIntents.empty());

        config.setupRoutes?.(fw.router);

        return fw;
    }

    private getLogger(): Logger {
        return (this._logger ??= this.container.resolve<Logger>(DEP_KEYS.LOGGER));
    }

    /** 分发 Intent — 获取页面数据 */
    async dispatch<T>(intent: Intent<T>): Promise<T> {
        const logger = this.getLogger();

        const cached = this.prefetchedIntents.get(intent);
        if (cached !== undefined) {
            logger.debug(
                `[Framework] re-using prefetched intent response for: ${intent.id}`,
                intent.params,
            );
            return cached;
        }

        logger.debug(`[Framework] dispatch intent: ${intent.id}`, intent.params);
        return this.intentDispatcher.dispatch(intent, this.container);
    }

    /** 执行 Action — 处理用户交互 */
    async perform(action: Action): Promise<void> {
        const logger = this.getLogger();
        logger.debug(`[Framework] perform action: ${action.kind}`);
        return this.actionDispatcher.perform(action);
    }

    /** 路由 URL — 将 URL 解析为 Intent + Action */
    routeUrl(url: string): RouteMatch | null {
        return this.router.resolve(url);
    }

    /** 记录页面访问事件 */
    didEnterPage(page: BasePage): void {
        const metrics = this.container.resolve<MetricsRecorder>(DEP_KEYS.METRICS);
        metrics.recordPageView(page.pageType, {
            pageId: page.id,
            title: page.title,
        });
    }

    /** 获取 locale 信息（如果已配置） */
    getLocale(): LocaleAttributes | undefined {
        return this.container.has(DEP_KEYS.LOCALE)
            ? this.container.resolve<LocaleAttributes>(DEP_KEYS.LOCALE)
            : undefined;
    }

    /** 获取平台信息 */
    getPlatform(): PlatformInfo {
        return this.container.resolve<PlatformInfo>(DEP_KEYS.PLATFORM);
    }

    /** 注册 Action 处理器 */
    onAction<A extends Action>(kind: string, handler: ActionHandler<A>): void {
        this.actionDispatcher.onAction(kind, handler);
    }

    /** 注册 Intent Controller */
    registerIntent(controller: IntentController): void {
        this.intentDispatcher.register(controller);
    }

    // ===== Navigation Middleware =====

    /** 注册 beforeLoad 守卫（路由匹配后、数据加载前） */
    beforeLoad(guard: BeforeLoadGuard): void {
        this.beforeGuards.push(guard);
    }

    /** 注册 afterLoad 守卫（数据加载后、渲染前） */
    afterLoad(guard: AfterLoadGuard): void {
        this.afterGuards.push(guard);
    }

    /** 执行所有 beforeLoad 守卫（全局 → 路由级） */
    runBeforeLoad(
        ctx: NavigationContext,
        routeGuards?: BeforeLoadGuard[],
    ): Promise<MiddlewareResult> {
        const guards = routeGuards?.length
            ? [...this.beforeGuards, ...routeGuards]
            : this.beforeGuards;
        return runBeforeLoadGuards(guards, ctx);
    }

    /** 执行所有 afterLoad 守卫（全局 → 路由级） */
    runAfterLoad(ctx: PostLoadContext, routeGuards?: AfterLoadGuard[]): Promise<MiddlewareResult> {
        const guards = routeGuards?.length
            ? [...this.afterGuards, ...routeGuards]
            : this.afterGuards;
        return runAfterLoadGuards(guards, ctx);
    }

    /** 销毁 Framework 实例 */
    dispose(): void {
        this.container.dispose();
    }
}
