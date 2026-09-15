/**
 * Framework — 框架核心类
 *
 * 对应原版 Jet 类，统一管理: DI 容器、Intent 分发、Action 分发、路由、Metrics。
 * 纯 TypeScript，不依赖任何 UI 框架。
 */

import { ActionDispatcher, type ActionHandler } from "./actions/dispatcher";
import type { Action } from "./actions/types";
import {
    Container,
    createRuntime,
    ExecutionError,
    type RuntimeHandle,
    type ExecutionHandle,
    type Invocation,
} from "@finesoft/core";
import { getWebPlan, WEB_EXECUTION, type WebExecutionState } from "./application/definition";
import type { WebAppDefinition } from "./application/types";
import type { MetricsRecorder } from "@finesoft/core";
import { DEP_KEYS } from "@finesoft/core";
import { makeDependencies, type MakeDependenciesOptions } from "./dependencies/make-dependencies";
import type { LocaleAttributes, Translator } from "@finesoft/core";
import type { Intent } from "@finesoft/core";
import type { Logger } from "@finesoft/core";
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
import type { PlatformInfo } from "@finesoft/core";

/** Framework 初始化配置 */
export interface FrameworkConfig extends MakeDependenciesOptions {
    definition: WebAppDefinition;
    runtime?: RuntimeHandle;
    invocation?: Invocation;
    prefetchedIntents?: PrefetchedIntents;
}

export class Framework {
    readonly container: Container;
    readonly actionDispatcher: ActionDispatcher;
    readonly router: Router;
    readonly prefetchedIntents: PrefetchedIntents;

    private readonly beforeGuards: BeforeLoadGuard[] = [];
    private readonly afterGuards: AfterLoadGuard[] = [];
    private _logger?: Logger;
    readonly runtime: RuntimeHandle;
    private readonly executions = new Set<ExecutionHandle>();
    private readonly config: FrameworkConfig;
    private closed = false;
    private disposal?: Promise<void>;
    readonly definition: WebAppDefinition;
    currentEntry?: import("./navigation/types").LeafNode;
    private readonly ownsRuntime: boolean;
    private constructor(config: FrameworkConfig) {
        this.config = config;
        this.definition = config.definition;
        const plan = getWebPlan(config.definition);
        this.prefetchedIntents = config.prefetchedIntents ?? PrefetchedIntents.empty();
        this.ownsRuntime = !config.runtime;
        this.runtime =
            config.runtime ??
            createRuntime({
                app: plan.app,
                capabilities: { fetch: config.fetch ?? globalThis.fetch?.bind(globalThis) },
                invocationCapabilities: ["fetch"],
                recorder: config.eventRecorder,
            });
        this.container = new Container();
        makeDependencies(this.container, config);
        this.actionDispatcher = new ActionDispatcher();
        this.router = plan.router;
        this.beforeGuards.push(...(config.definition?.beforeLoad ?? []));
        this.afterGuards.push(...(config.definition?.afterLoad ?? []));
    }

    static create(config: FrameworkConfig): Framework {
        return new Framework({ ...config.definition?.frameworkConfig, ...config });
    }

    private getLogger(): Logger {
        return (this._logger ??= this.container.resolve<Logger>(DEP_KEYS.LOGGER));
    }

    /** 分发 Intent — 获取页面数据 */
    async dispatch<T>(
        intent: Intent<T>,
        execution?: ExecutionHandle,
        retained?: BasePage,
        entryId?: string,
    ): Promise<T> {
        const operation = getWebPlan(this.definition).operations.get(intent.id);
        if (!operation) throw new ExecutionError("not_found");
        const owned = !execution;
        execution ??= this.createExecution();
        try {
            const params = { ...intent.params };
            const state = execution.context.bindings[WEB_EXECUTION] as WebExecutionState;
            if (entryId) {
                state.entryIds.set(params, entryId);
                state.entryIds.set(intent, entryId);
            }
            if (retained)
                (execution.context.bindings[WEB_EXECUTION] as WebExecutionState).retained.set(
                    params,
                    retained,
                );
            return (await execution.execute(operation, params)) as T;
        } finally {
            if (owned) await execution.dispose();
        }
    }

    /** 执行 Action — 处理用户交互 */
    async perform(action: Action): Promise<void> {
        const logger = this.getLogger();
        logger.debug(`[Framework] perform action: ${action.kind}`);
        return this.actionDispatcher.perform(action);
    }

    /** 路由 URL — 将 URL 解析为 Intent + Action */
    async routeUrl(url: string): Promise<RouteMatch | null> {
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

    /** 获取翻译器（如果当前 locale 已经初始化了翻译字典） */
    getTranslator(): Translator | undefined {
        return this.container.has(DEP_KEYS.TRANSLATOR)
            ? this.container.resolve<Translator>(DEP_KEYS.TRANSLATOR)
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
    createExecution(invocation: Invocation = {}): ExecutionHandle {
        if (this.closed) throw new ExecutionError("configuration", "Framework is closed");
        const base = this.config.invocation;
        const signals = [base?.signal, invocation.signal].filter((s): s is AbortSignal => !!s);
        const execution = this.runtime.createExecution({
            ...base,
            ...invocation,
            signal: signals.length ? AbortSignal.any(signals) : undefined,
            locale: invocation.locale ?? base?.locale ?? this.config.locale,
            fetch: invocation.fetch ?? base?.fetch ?? this.config.fetch,
            bindings: {
                ...base?.bindings,
                ...invocation.bindings,
                [WEB_EXECUTION]: {
                    prefetched: this.prefetchedIntents,
                    retained: new WeakMap(),
                    entryIds: new WeakMap(),
                },
            },
        });
        makeDependencies(execution.context.container, {
            ...this.config,
            fetch: execution.context.fetch,
            locale: execution.context.locale,
        });
        // Environment defaults are shared by this facade only. Business typed providers remain in Runtime.
        for (const key of [
            DEP_KEYS.LOGGER_FACTORY,
            DEP_KEYS.LOGGER,
            DEP_KEYS.STORAGE,
            DEP_KEYS.FEATURE_FLAGS,
            DEP_KEYS.METRICS,
            DEP_KEYS.EVENT_RECORDER,
            DEP_KEYS.PLATFORM,
        ])
            execution.context.container.register(key, () => this.container.resolve(key));
        const dispose = execution.dispose.bind(execution);
        execution.dispose = async () => {
            try {
                await dispose();
            } finally {
                this.executions.delete(execution);
            }
        };
        this.executions.add(execution);
        return execution;
    }

    dispose(): Promise<void> {
        this.closed = true;
        return (this.disposal ??= (async () => {
            const results = await Promise.allSettled(
                [...this.executions].map((execution) => execution.dispose()),
            );
            results.push(...(await Promise.allSettled([this.container.dispose()])));
            if (this.ownsRuntime)
                results.push(...(await Promise.allSettled([this.runtime.dispose()])));
            const failures = results
                .filter((result) => result.status === "rejected")
                .map((result) => result.reason);
            if (failures.length) throw new AggregateError(failures, "Framework cleanup failed");
        })());
    }
}
