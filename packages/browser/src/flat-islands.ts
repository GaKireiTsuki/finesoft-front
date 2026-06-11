/**
 * activateFlatIslands — 扁平应用的隐式单栈 islands 激活器（Phase 4）。
 *
 * 当应用提供顶层 `mountEntry`（且未配 `navigation`）时，`start-app.ts` 调用本函数：
 * 1. 用初始 URL 路由出首屏 leaf，合成 `initial = stack([leaf(intent, params)])`。
 * 2. 构建 `NavigationController`（createBrowserContext / prefetchedIntents / onRedirect）。
 * 3. 构建 `NavigationBridge`（codec = `createFlatStackCodec()`，owns history + popstate）。
 * 4. 构建 `IslandOrchestrator`，订阅 controller 快照并同步 DOM。
 * 5. `controller.resolve()` 渲染首屏 island（start-app 的 step-6 perform 跳过）。
 * 6. 暴露 `pushUrl(url)`：路由 url → intent/params → `controller.push(intent, params)`，
 *    供 `onForward` 钩子使用。
 *
 * 依赖：Phase 0 NavigationBridge + Phase 2 IslandOrchestrator（均已落地）。
 */

import type { Framework, Logger, NavigationController } from "@finesoft/core";
import {
    createBrowserContext,
    createFlatStackCodec,
    createNavigationController,
    leaf,
    makeFlowAction,
    stack,
} from "@finesoft/core";
import type { MountEntry } from "./navigation-islands";
import { createIslandOrchestrator } from "./navigation-islands";
import type { NavigationHandle } from "./navigation-bridge";
import { createNavigationBridge } from "./navigation-bridge";

/** activateFlatIslands 的参数。 */
export interface FlatIslandsArgs {
    framework: Framework;
    initialUrl: string;
    mountEntry: MountEntry;
    target: HTMLElement;
    log: Logger;
    getScrollablePageElement?: () => HTMLElement | null;
}

/** activateFlatIslands 的返回值。 */
export interface ActivatedFlatIslands {
    /** NavigationBridge handle（含 subscribe / push / hydrate 等）。 */
    handle: NavigationHandle;
    /** 底层 controller（供会话结构化适配器引用）。 */
    controller: NavigationController;
    /** outlet 元素（供 domRestore 接线）。 */
    outlet: HTMLElement;
    /**
     * 正向导航函数：把 URL 路由成 intent/params 后调 controller.push。
     * 供 onForward 钩子注入，绑定到隐式单栈。
     */
    pushUrl: (url: string) => Promise<void>;
}

/**
 * 合成隐式单栈 NavigationController + NavigationBridge + IslandOrchestrator，
 * 并解析首屏 island。返回后 start-app 应跳过 step-6 framework.perform(initialAction)
 * 避免双重渲染。
 */
export async function activateFlatIslands(args: FlatIslandsArgs): Promise<ActivatedFlatIslands> {
    const { framework, initialUrl, mountEntry, target, log, getScrollablePageElement } = args;

    // ── 1. 路由初始 URL → 合成首屏单叶栈 ─────────────────────────────────────
    const initialMatch = await framework.routeUrl(initialUrl);
    const initial =
        initialMatch !== null
            ? stack([
                  leaf(
                      initialMatch.intent.id,
                      (initialMatch.intent.params ?? {}) as Record<string, string>,
                  ),
              ])
            : stack([leaf("__not_found__", {})]);

    // ── 2. 构建 NavigationController ──────────────────────────────────────────
    const codec = createFlatStackCodec();

    const controller = createNavigationController({
        intentDispatcher: framework.intentDispatcher,
        router: framework.router,
        initial,
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
        prefetched: framework.prefetchedIntents,
        onRedirect: ({ url }) => {
            void framework.perform(makeFlowAction(url));
        },
    });

    // ── 3. 构建 NavigationBridge（owns history + popstate）────────────────────
    const handle = createNavigationBridge({
        controller,
        codec,
        router: framework.router,
        log,
        getScrollablePageElement,
    });

    // ── 4. 找 outlet，构建 IslandOrchestrator，订阅 snapshot ──────────────────
    const found = target.querySelector<HTMLElement>("[data-fs-outlet]");
    if (!found) {
        throw new Error(
            "[startBrowserApp] mountEntry 已提供（flat-islands），但 mount 渲染的 DOM 里" +
                "找不到 [data-fs-outlet]。请在 mount 回调里放一个稳定、空的 <main data-fs-outlet></main>。",
        );
    }
    const outlet = found;

    const orchestrator = createIslandOrchestrator({ outlet, mountEntry });
    orchestrator.sync(controller.getSnapshot());
    controller.subscribe((snapshot) => orchestrator.sync(snapshot));

    // ── 5. 解析首屏 island（一次 resolve()）───────────────────────────────────
    //    bridge 已订阅 controller（上面 createNavigationBridge 内部），
    //    resolve() 触发快照提交 → bridge 用 replaceState 写入 history（first-page）。
    await controller.resolve();

    // ── 6. 暴露 pushUrl（供 onForward 注入）──────────────────────────────────
    async function pushUrl(url: string): Promise<void> {
        const match = await framework.routeUrl(url);
        if (!match) {
            log.warn(`[flat-islands] pushUrl: no route for ${url}`);
            return;
        }
        await controller.push(
            match.intent.id,
            (match.intent.params ?? {}) as Record<string, string>,
        );
    }

    return { handle, controller, outlet, pushUrl };
}
