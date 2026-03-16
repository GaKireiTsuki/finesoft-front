/**
 * FlowAction Handler — 核心 SPA 导航处理器
 *
 * 通过 FlowActionCallbacks 注入 UI 更新回调，
 * 不直接依赖任何 UI 框架的 store。
 */

import type { BasePage, FlowAction, Framework, Logger, PostLoadContext } from "@finesoft/core";
import { ACTION_KINDS, createBrowserContext } from "@finesoft/core";
import { History } from "../utils/history";

/** FlowAction handler 的 History state */
interface FlowState {
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
    framework: Framework;
    log: Logger;
    callbacks: FlowActionCallbacks;
    /** 更新应用 UI 的回调，page 可以是 Promise */
    updateApp: (props: { page: Promise<BasePage> | BasePage; isFirstPage?: boolean }) => void;
    /** 获取可滚动页面元素，用于滚动位置保存/恢复 */
    getScrollablePageElement?: () => HTMLElement | null;
}

export function registerFlowActionHandler(deps: FlowActionDependencies): void {
    const { framework, log, callbacks, updateApp } = deps;
    let isFirstPage = true;
    let navigationId = 0;

    /** 重定向循环保护计数器 */
    const MAX_REDIRECTS = 5;

    const defaultGetScrollable = (): HTMLElement | null =>
        document.getElementById("scrollable-page-override") ||
        document.getElementById("scrollable-page") ||
        document.documentElement;

    const history = new History<FlowState>(log, {
        getScrollablePageElement: deps.getScrollablePageElement ?? defaultGetScrollable,
    });

    /**
     * 核心导航逻辑（支持递归重定向）
     * @param redirectCount 当前重定向次数，用于循环保护
     */
    async function navigateTo(url: string, redirectCount: number, thisNav: number): Promise<void> {
        if (redirectCount >= MAX_REDIRECTS) {
            log.error(
                `Navigation redirect loop detected (${MAX_REDIRECTS} redirects), stopping at: ${url}`,
            );
            return;
        }

        const shouldReplace =
            isFirstPage || url === window.location.pathname + window.location.search;

        const match = framework.routeUrl(url);
        if (!match) {
            log.warn(`FlowAction: no route for ${url}`);
            return;
        }

        // ===== beforeLoad 中间件 =====
        const navCtx = createBrowserContext({
            url,
            intent: match.intent,
            container: framework.container,
        });
        const beforeResult = await framework.runBeforeLoad(navCtx, match.beforeGuards);

        if (beforeResult.kind === "redirect") {
            log.debug(`beforeLoad → redirect to ${beforeResult.url}`);
            await navigateTo(beforeResult.url, redirectCount + 1, thisNav);
            return;
        }
        if (beforeResult.kind === "deny") {
            log.warn(`beforeLoad → denied (${beforeResult.status}): ${beforeResult.message}`);
            return;
        }
        // rewrite in beforeLoad: 无数据可言，当作 redirect 处理
        if (beforeResult.kind === "rewrite") {
            log.debug(`beforeLoad → rewrite to ${beforeResult.url}`);
            await navigateTo(beforeResult.url, redirectCount + 1, thisNav);
            return;
        }

        const pagePromise = framework.dispatch(match.intent) as Promise<BasePage>;

        await Promise.race([pagePromise, new Promise((r) => setTimeout(r, 500))]).catch(() => {});

        if (thisNav !== navigationId) {
            log.info("FlowAction superseded by newer navigation", url);
            return;
        }

        history.beforeTransition();

        updateApp({
            page: pagePromise.then(
                async (page: BasePage): Promise<BasePage> => {
                    if (thisNav !== navigationId) {
                        log.info("FlowAction commit superseded", url);
                        return page;
                    }

                    // ===== afterLoad 中间件 =====
                    const postCtx: PostLoadContext = {
                        ...navCtx,
                        page,
                    };
                    const afterResult = await framework.runAfterLoad(postCtx, match.afterGuards);

                    if (afterResult.kind === "redirect") {
                        log.debug(`afterLoad → redirect to ${afterResult.url}`);
                        void navigateTo(afterResult.url, redirectCount + 1, thisNav);
                        return page;
                    }

                    let canonicalURL = url;

                    if (afterResult.kind === "rewrite") {
                        // rewrite: 仅更新地址栏，保留已加载的 page 数据
                        canonicalURL = afterResult.url;
                        log.debug(`afterLoad → rewrite URL to ${canonicalURL}`);
                    }

                    if (afterResult.kind === "deny") {
                        log.warn(`afterLoad → denied (${afterResult.status})`);
                        return page;
                    }

                    if (shouldReplace) {
                        history.replaceState({ page }, canonicalURL);
                    } else {
                        history.pushState({ page }, canonicalURL);
                    }

                    callbacks.onNavigate(new URL(canonicalURL, window.location.origin).pathname);

                    didEnterPage(page);
                    return page;
                },
                (error: unknown) => {
                    // 页面加载失败仍需推入历史记录，确保 back/forward 正常
                    if (thisNav === navigationId) {
                        const canonicalURL = url;
                        if (shouldReplace) {
                            history.replaceUrl(canonicalURL);
                        } else {
                            history.pushUrl(canonicalURL);
                        }
                        callbacks.onNavigate(
                            new URL(canonicalURL, window.location.origin).pathname,
                        );
                    }
                    throw error;
                },
            ),
            isFirstPage,
        });

        isFirstPage = false;
    }

    // ===== FlowAction handler =====
    framework.onAction(ACTION_KINDS.FLOW, async (action) => {
        const flowAction = action as FlowAction;
        const url = flowAction.url;
        log.debug(`FlowAction → ${url}`);

        // 模态展示
        if (flowAction.presentationContext === "modal") {
            const match = framework.routeUrl(url);
            if (match) {
                const page = (await framework.dispatch(match.intent)) as BasePage;
                callbacks.onModal(page);
            }
            return;
        }

        const thisNav = ++navigationId;
        await navigateTo(url, 0, thisNav);
    });

    // ===== popstate handler =====
    history.onPopState(async (url, cachedState) => {
        log.debug(`popstate → ${url}, cached=${!!cachedState}`);

        callbacks.onNavigate(new URL(url).pathname);

        if (cachedState) {
            const { page } = cachedState;
            didEnterPage(page);
            updateApp({ page, isFirstPage });
            return;
        }

        const parsed = new URL(url);
        const routeMatch = framework.routeUrl(parsed.pathname + parsed.search);
        if (!routeMatch) {
            log.error("received popstate without data, but URL was unroutable:", url);
            didEnterPage(null);
            updateApp({
                page: Promise.reject(new Error("404")),
                isFirstPage,
            });
            return;
        }

        // ===== beforeLoad 中间件 =====
        const navCtx = createBrowserContext({
            url: parsed.pathname + parsed.search,
            intent: routeMatch.intent,
            container: framework.container,
        });
        const beforeResult = await framework.runBeforeLoad(navCtx, routeMatch.beforeGuards);

        if (beforeResult.kind === "redirect") {
            log.debug(`popstate beforeLoad → redirect to ${beforeResult.url}`);
            const thisNav = ++navigationId;
            await navigateTo(beforeResult.url, 0, thisNav);
            return;
        }
        if (beforeResult.kind === "deny" || beforeResult.kind === "rewrite") {
            // popstate 场景下 deny/rewrite 直接触发跳转
            if (beforeResult.kind === "deny") {
                log.warn(`popstate beforeLoad → denied`);
            } else {
                const thisNav = ++navigationId;
                await navigateTo(beforeResult.url, 0, thisNav);
            }
            return;
        }

        const pagePromise = framework.dispatch(routeMatch.intent) as Promise<BasePage>;

        await Promise.race([pagePromise, new Promise((r) => setTimeout(r, 500))]).catch(() => {});

        updateApp({
            page: pagePromise.then((page: BasePage): BasePage => {
                didEnterPage(page);
                return page;
            }),
            isFirstPage,
        });
    });

    function didEnterPage(page: BasePage | null): void {
        void (async (): Promise<void> => {
            try {
                if (page) {
                    framework.didEnterPage(page);
                }
            } catch (e) {
                log.error("didEnterPage error:", e);
            }
        })();
    }
}
