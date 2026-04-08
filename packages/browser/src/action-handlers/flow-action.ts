/**
 * FlowAction Handler — 核心 SPA 导航处理器
 *
 * 通过 FlowActionCallbacks 注入 UI 更新回调，
 * 不直接依赖任何 UI 框架状态容器。
 */

import type {
    BasePage,
    FlowAction,
    Framework,
    Logger,
    PostLoadContext,
    RouteMatch,
} from "@finesoft/core";
import { ACTION_KINDS, createBrowserContext } from "@finesoft/core";
import type { KeepAliveController } from "../keep-alive";
import { toKeepAliveCacheKey } from "../keep-alive";
import type { BrowserNavigationType, BrowserUpdateAppProps } from "../types";
import { History } from "../utils/history";

/** FlowAction handler 的 History state */
interface FlowState {
    page: BasePage;
}

/** UI 框架回调 — 解耦 React / Vue / Svelte 等依赖 */
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
    updateApp: (props: BrowserUpdateAppProps) => void;
    keepAlive: KeepAliveController;
    /** 获取可滚动页面元素，用于滚动位置保存/恢复 */
    getScrollablePageElement?: () => HTMLElement | null;
}

interface NavigationCommitOptions {
    page: BasePage;
    url: string;
    requestedKey: string;
    navCtx: ReturnType<typeof createBrowserContext>;
    match: RouteMatch;
    redirectCount: number;
    thisNav: number;
    shouldReplace: boolean;
    navigationType: BrowserNavigationType;
}

interface NavigationCommitResult {
    committed: boolean;
    page: BasePage;
    canonicalUrl: string;
    cacheKey: string;
}

export function registerFlowActionHandler(deps: FlowActionDependencies): void {
    const { framework, log, callbacks, updateApp, keepAlive } = deps;
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
    async function navigateTo(
        url: string,
        redirectCount: number,
        thisNav: number,
        navigationType: BrowserNavigationType,
    ): Promise<void> {
        if (redirectCount >= MAX_REDIRECTS) {
            log.error(
                `Navigation redirect loop detected (${MAX_REDIRECTS} redirects), stopping at: ${url}`,
            );
            return;
        }

        const shouldReplace =
            isFirstPage || url === window.location.pathname + window.location.search;
        const requestedKey = toKeepAliveCacheKey(url);

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
            await navigateTo(beforeResult.url, redirectCount + 1, thisNav, "redirect");
            return;
        }
        if (beforeResult.kind === "deny") {
            log.warn(`beforeLoad → denied (${beforeResult.status}): ${beforeResult.message}`);
            return;
        }
        if (beforeResult.kind === "rewrite") {
            log.debug(`beforeLoad → rewrite to ${beforeResult.url}`);
            await navigateTo(beforeResult.url, redirectCount + 1, thisNav, "redirect");
            return;
        }

        const cachedMatch = keepAlive.resolve(requestedKey);
        if (cachedMatch) {
            history.beforeTransition();

            updateApp({
                page: cachedMatch.entry.page,
                isFirstPage,
                cacheKey: cachedMatch.key,
                cacheHit: true,
                navigationType,
            });

            const committed = await finalizeNavigation({
                page: cachedMatch.entry.page,
                url,
                requestedKey,
                navCtx,
                match,
                redirectCount,
                thisNav,
                shouldReplace,
                navigationType,
            });

            if (committed.committed) {
                isFirstPage = false;
            }
            return;
        }

        const pagePromise = framework.dispatch(match.intent) as Promise<BasePage>;

        await Promise.race([pagePromise, new Promise((resolve) => setTimeout(resolve, 500))]).catch(
            () => {},
        );

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

                    const committed = await finalizeNavigation({
                        page,
                        url,
                        requestedKey,
                        navCtx,
                        match,
                        redirectCount,
                        thisNav,
                        shouldReplace,
                        navigationType,
                    });

                    if (committed.committed && committed.cacheKey !== requestedKey) {
                        updateApp({
                            page,
                            cacheKey: committed.cacheKey,
                            cacheHit: false,
                            navigationType,
                        });
                    }

                    return committed.page;
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
            cacheKey: requestedKey,
            cacheHit: false,
            navigationType,
        });

        isFirstPage = false;
    }

    async function finalizeNavigation(
        options: NavigationCommitOptions,
    ): Promise<NavigationCommitResult> {
        const { page, url, requestedKey, navCtx, match, redirectCount, thisNav, shouldReplace } =
            options;

        const postCtx: PostLoadContext = {
            ...navCtx,
            page,
        };
        const afterResult = await framework.runAfterLoad(postCtx, match.afterGuards);

        if (afterResult.kind === "redirect") {
            log.debug(`afterLoad → redirect to ${afterResult.url}`);
            void navigateTo(afterResult.url, redirectCount + 1, thisNav, "redirect");
            return {
                committed: false,
                page,
                canonicalUrl: url,
                cacheKey: requestedKey,
            };
        }

        let canonicalUrl = url;

        if (afterResult.kind === "rewrite") {
            canonicalUrl = afterResult.url;
            log.debug(`afterLoad → rewrite URL to ${canonicalUrl}`);
        }

        if (afterResult.kind === "deny") {
            log.warn(`afterLoad → denied (${afterResult.status})`);
            return {
                committed: true,
                page,
                canonicalUrl,
                cacheKey: toKeepAliveCacheKey(canonicalUrl),
            };
        }

        const cacheKey = toKeepAliveCacheKey(canonicalUrl);
        keepAlive.remember(cacheKey, page, [requestedKey]);

        if (shouldReplace) {
            history.replaceState({ page }, canonicalUrl);
        } else {
            history.pushState({ page }, canonicalUrl);
        }

        callbacks.onNavigate(new URL(canonicalUrl, window.location.origin).pathname);

        didEnterPage(page);

        return {
            committed: true,
            page,
            canonicalUrl,
            cacheKey,
        };
    }

    // ===== FlowAction handler =====
    framework.onAction(ACTION_KINDS.FLOW, async (action) => {
        const flowAction = action as FlowAction;
        const url = flowAction.url;
        log.debug(`FlowAction → ${url}`);

        if (flowAction.presentationContext === "modal") {
            const match = framework.routeUrl(url);
            if (match) {
                const page = (await framework.dispatch(match.intent)) as BasePage;
                callbacks.onModal(page);
            }
            return;
        }

        const thisNav = ++navigationId;
        await navigateTo(url, 0, thisNav, "navigate");
    });

    // ===== popstate handler =====
    history.onPopState(async (url, cachedState) => {
        log.debug(`popstate → ${url}, cached=${!!cachedState}`);

        const parsed = new URL(url);
        const currentUrl = parsed.pathname + parsed.search;
        const currentKey = toKeepAliveCacheKey(currentUrl);

        callbacks.onNavigate(parsed.pathname);

        const routeMatch = framework.routeUrl(currentUrl);
        if (!routeMatch) {
            log.error("received popstate without data, but URL was unroutable:", url);
            didEnterPage(null);
            updateApp({
                page: Promise.reject(new Error("404")),
                isFirstPage,
                cacheKey: currentKey,
                cacheHit: false,
                navigationType: "popstate",
            });
            return;
        }

        const navCtx = createBrowserContext({
            url: currentUrl,
            intent: routeMatch.intent,
            container: framework.container,
        });
        const beforeResult = await framework.runBeforeLoad(navCtx, routeMatch.beforeGuards);

        if (beforeResult.kind === "redirect") {
            log.debug(`popstate beforeLoad → redirect to ${beforeResult.url}`);
            const thisNav = ++navigationId;
            await navigateTo(beforeResult.url, 0, thisNav, "redirect");
            return;
        }
        if (beforeResult.kind === "deny" || beforeResult.kind === "rewrite") {
            if (beforeResult.kind === "deny") {
                log.warn("popstate beforeLoad → denied");
            } else {
                const thisNav = ++navigationId;
                await navigateTo(beforeResult.url, 0, thisNav, "redirect");
            }
            return;
        }

        const cachedMatch = keepAlive.resolve(currentKey);
        if (cachedMatch) {
            updateApp({
                page: cachedMatch.entry.page,
                isFirstPage,
                cacheKey: cachedMatch.key,
                cacheHit: true,
                navigationType: "popstate",
            });

            const committed = await finalizeNavigation({
                page: cachedMatch.entry.page,
                url: currentUrl,
                requestedKey: currentKey,
                navCtx,
                match: routeMatch,
                redirectCount: 0,
                thisNav: navigationId,
                shouldReplace: true,
                navigationType: "popstate",
            });

            if (committed.committed && committed.cacheKey !== currentKey) {
                updateApp({
                    page: cachedMatch.entry.page,
                    cacheKey: committed.cacheKey,
                    cacheHit: true,
                    navigationType: "popstate",
                });
            }
            return;
        }

        if (cachedState) {
            const { page } = cachedState;
            const committed = await finalizeNavigation({
                page,
                url: currentUrl,
                requestedKey: currentKey,
                navCtx,
                match: routeMatch,
                redirectCount: 0,
                thisNav: navigationId,
                shouldReplace: true,
                navigationType: "popstate",
            });

            updateApp({
                page,
                isFirstPage,
                cacheKey: committed.cacheKey,
                cacheHit: false,
                navigationType: "popstate",
            });
            return;
        }

        const pagePromise = framework.dispatch(routeMatch.intent) as Promise<BasePage>;
        await Promise.race([pagePromise, new Promise((resolve) => setTimeout(resolve, 500))]).catch(
            () => {},
        );

        updateApp({
            page: pagePromise.then(async (page: BasePage): Promise<BasePage> => {
                const committed = await finalizeNavigation({
                    page,
                    url: currentUrl,
                    requestedKey: currentKey,
                    navCtx,
                    match: routeMatch,
                    redirectCount: 0,
                    thisNav: navigationId,
                    shouldReplace: true,
                    navigationType: "popstate",
                });

                if (committed.cacheKey !== currentKey) {
                    updateApp({
                        page,
                        cacheKey: committed.cacheKey,
                        cacheHit: false,
                        navigationType: "popstate",
                    });
                }

                return committed.page;
            }),
            isFirstPage,
            cacheKey: currentKey,
            cacheHit: false,
            navigationType: "popstate",
        });
    });

    function didEnterPage(page: BasePage | null): void {
        void (async (): Promise<void> => {
            try {
                if (page) {
                    framework.didEnterPage(page);
                }
            } catch (error) {
                log.error("didEnterPage error:", error);
            }
        })();
    }
}
