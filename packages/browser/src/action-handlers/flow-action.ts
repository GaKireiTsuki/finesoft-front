/**
 * FlowAction Handler — 核心 SPA 导航处理器
 *
 * 通过 FlowActionCallbacks 注入 UI 更新回调，
 * 不直接依赖任何 UI 框架的 store。
 */

import type { BasePage, Framework } from "@finesoft/web";
import type { FlowAction } from "@finesoft/web";
import type { Logger } from "@finesoft/core";
import { ExecutionError } from "@finesoft/core";
import { ACTION_KINDS, loadPage } from "@finesoft/web";
import { createBrowserContext } from "../middleware/context";
import { History } from "../utils/history";

/** FlowAction handler 的 History state */
interface FlowState {
    entryId?: string;
    page: BasePage;
}

/** UI 框架回调 — 解耦 Svelte store 等依赖 */
export interface FlowActionCallbacks {
    /** 导航后更新当前路径（替代 currentPath.set()） */
    onNavigate(pathname: string): void;
    /** 模态页面展示（替代 openModal()） */
    onModal(page: BasePage): void;
}

/** 注册 FlowAction handler 所需的依赖 */
export interface FlowActionDependencies {
    viewReady?: () => void | Promise<void>;
    framework: Framework;
    log: Logger;
    callbacks: FlowActionCallbacks;
    /** 更新应用 UI 的回调，page 可以是 Promise */
    updateApp: (props: {
        page: Promise<BasePage> | BasePage;
        isFirstPage?: boolean;
    }) => void | Promise<void>;
    /** 获取可滚动页面元素，用于滚动位置保存/恢复 */
    getScrollablePageElement?: () => HTMLElement | null;
    /**
     * 是否由本 handler 管理浏览器 history（pushState / popstate）。缺省 `true`。
     * 结构化导航（`startBrowserApp({ navigation })`）下应传 `false`：history 由
     * NavigationBridge 独占，否则两套 `History` 实例会争抢同一个 `window.history.state`、
     * 各自注册 popstate 互相 clobber，导致 back/forward 行为错乱。传 `false` 时本 handler
     * 仍负责 dispatch + updateApp（初始渲染 / redirect / modal），只是不碰 history。
     */
    manageHistory?: boolean;
    /**
     * flat-islands 正向导航钩子（可选）。提供后，正向 FlowAction（非 modal）会调用此函数
     * 并 return，**绕过** navigateTo / updateApp。由 activateFlatIslands 注入，把 URL
     * 路由到隐式单栈 `NavigationController.push`。未提供时行为与今天扁平路径字节级相同。
     */
    onForward?: (url: string) => void | Promise<void>;
}

export function registerFlowActionHandler(deps: FlowActionDependencies): void {
    const { framework, log, callbacks, updateApp } = deps;
    let first = true;
    let sequence = 0;
    let active: AbortController | undefined;
    const history =
        (deps.manageHistory ?? true)
            ? new History<FlowState>(log, {
                  getScrollablePageElement:
                      deps.getScrollablePageElement ??
                      (() =>
                          document.getElementById("scrollable-page-override") ||
                          document.getElementById("scrollable-page") ||
                          document.documentElement),
              })
            : undefined;

    async function navigate(
        url: string,
        options: { pop?: boolean; cached?: FlowState; modal?: boolean; entryId?: string } = {},
    ): Promise<void> {
        active?.abort();
        const abort = new AbortController();
        active = abort;
        const id = ++sequence;
        const execution = framework.createExecution({ signal: abort.signal });
        const current = () => {
            if (abort.signal.aborted || id !== sequence) throw new ExecutionError("cancelled");
        };
        let redirected = false;
        const loaded = (async () => {
            const parsed = new URL(url, window.location.origin);
            let target = parsed.pathname + parsed.search;
            let retained = options.cached?.page;
            for (let depth = 0; depth < 5; depth++) {
                const result = await loadPage({
                    framework,
                    target,
                    execution,
                    retained,
                    entryId: options.entryId ?? options.cached?.entryId,
                    createContext: ({ url: destinationUrl, intent, execution: scope }) =>
                        createBrowserContext({
                            url: destinationUrl,
                            intent,
                            container: scope.context.container,
                        }),
                });
                current();
                if (result.kind === "redirect") {
                    redirected = true;
                    target = result.url;
                    retained = undefined;
                    continue;
                }
                if (result.kind === "deny")
                    throw new ExecutionError(
                        result.status === 404 ? "not_found" : "denied",
                        result.message,
                    );
                return result;
            }
            throw new ExecutionError("configuration", "Navigation redirect loop detected");
        })();
        // Attach rejection handling before yielding to the loading threshold.
        const settled = loaded.then(
            () => true,
            () => true,
        );
        try {
            await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, 500))]);
            current();
            const pagePromise = loaded.then((result) => {
                current();
                return result.page;
            });
            void pagePromise.catch(() => {});
            // An already rejected navigation never reaches the view.
            if (await Promise.race([settled, Promise.resolve(false)])) await loaded;
            if (options.modal) {
                callbacks.onModal(await pagePromise);
                return;
            }
            const view = updateApp({ page: pagePromise, isFirstPage: first });
            const result = await loaded;
            current();
            const canonical = result.rewriteUrl ?? result.target.url ?? url;
            if (options.pop && !redirected) {
                if (
                    canonical !==
                    new URL(url, window.location.origin).pathname +
                        new URL(url, window.location.origin).search
                )
                    window.history.replaceState(window.history.state, "", canonical);
            } else {
                history?.beforeTransition();
                const state = { page: result.page, entryId: result.target.entryId };
                if (first) history?.replaceState(state, canonical);
                else history?.pushState(state, canonical);
            }
            framework.currentEntry = result.target;
            callbacks.onNavigate(new URL(canonical, window.location.origin).pathname);
            try {
                framework.didEnterPage(result.page);
            } catch (error) {
                log.error("didEnterPage error:", error);
            }
            first = false;
            await view;
            await deps.viewReady?.();
            current();
        } catch (error) {
            if (!(error instanceof ExecutionError && error.code === "cancelled"))
                log.warn(
                    "Navigation did not commit",
                    error instanceof ExecutionError ? error.code : "failure",
                );
        } finally {
            await execution.dispose();
        }
    }
    framework.onAction(ACTION_KINDS.FLOW, async (action) => {
        const flow = action as FlowAction;
        if (flow.presentationContext !== "modal" && deps.onForward) {
            await deps.onForward(flow.url);
            return;
        }
        await navigate(flow.url, {
            modal: flow.presentationContext === "modal",
            entryId: flow.entryId,
        });
    });
    history?.onPopState((url, cached) => navigate(url, { pop: true, cached }));
}
