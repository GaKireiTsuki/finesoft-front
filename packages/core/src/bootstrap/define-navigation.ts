/**
 * defineNavigation — 声明式结构化导航定义
 *
 * 与 `defineRoutes` 并列：在同一个 `bootstrap(framework)` 处声明应用的导航结构
 * （初始树 + URL codec + 导航级守卫 + 兜底错误页），产出一个 `NavigationDefinition`，
 * 由应用分别交给 `startBrowserApp({ navigation })`（CSR）与
 * `createSSRNavigationRender({ navigation })`（SSR）。
 *
 * 完全可选、纯附加：不调用 `defineNavigation` 的应用走原有扁平单页路径，行为不变。
 * `defineNavigation` 本身不改写 Framework 的路由表——它只把声明规范化为定义对象，
 * 并不绑定到某个 Framework 实例（不需要 Framework 参数）。
 *
 * 关键适配：浏览器侧 runner 期望 `initial: NavigationNode`，SSR 侧 runner 期望
 * `initial?: (url: string) => NavigationNode | undefined`（codec 无结构化覆盖时的骨架工厂）。
 * 为了让应用「只声明一次」，`initial` 在此接受「静态树」或「工厂函数」二者之一，
 * 由 `toBrowserConfig()` / `toSSRDefinition()` 适配出各 runner 需要的精确形态。
 */

import {
    createActiveLeafCodec,
    isLeafNode,
    isSplitNode,
    isStackNode,
    isTabsNode,
    type NavigationCodec,
    type NavigationNode,
} from "../navigation";
import type { AfterLoadGuard, BeforeLoadGuard } from "../middleware/types";
import type { BasePage } from "../models/page";

/**
 * `initial` 既可是一棵静态初始树，也可是按 URL 产出树骨架的工厂。
 *
 * - 静态树：所有请求（CSR 首屏 / SSR 无深链回退）都以这棵树为初始结构。
 * - 工厂 `(url) => NavigationNode | undefined`：按请求 URL 动态决定骨架；返回 `undefined`
 *   表示「此 URL 无结构化骨架」，SSR 侧据此回退到「`Router.resolve` → 单 LeafNode」
 *   （今天的单页行为）。CSR 侧首屏对工厂传入当前 `window.location` 的 path+query。
 */
export type NavigationInitial = NavigationNode | ((url: string) => NavigationNode | undefined);

/**
 * 浏览器 runner（`startBrowserApp`）期望的导航配置形态。
 *
 * 与 `@finesoft/browser` 的 `BrowserNavigationConfig` 结构等价（`initial` 为具体树）；
 * 在 core 中以结构化形状声明，避免 core → browser 的反向依赖。
 */
export interface NavigationBrowserConfig {
    readonly initial: NavigationNode;
    readonly codec?: NavigationCodec;
    readonly beforeLoad?: readonly BeforeLoadGuard[];
    readonly afterLoad?: readonly AfterLoadGuard[];
    readonly getErrorPage?: (status: number, message: string) => BasePage;
}

/**
 * SSR runner（`createSSRNavigationRender` / `ssrRenderNavigation`）期望的导航定义形态。
 *
 * 与 `@finesoft/ssr` 的 `SSRNavigationDefinition` 结构等价（`codec` 必填、`initial`
 * 为骨架工厂）；在 core 中以结构化形状声明，避免 core → ssr 的反向依赖。
 */
export interface NavigationSSRDefinition {
    readonly codec: NavigationCodec;
    readonly initial?: (url: string) => NavigationNode | undefined;
    readonly beforeLoad?: readonly BeforeLoadGuard[];
    readonly afterLoad?: readonly AfterLoadGuard[];
}

/** `defineNavigation` 的输入声明。 */
export interface DefineNavigationOptions {
    /**
     * 初始导航结构：静态树或按 URL 产出树骨架的工厂。
     * 单个 `leaf(...)` 树即为今天的扁平单页（向后兼容）。
     */
    readonly initial: NavigationInitial;
    /**
     * URL ⇄ 树 编解码器；缺省 `createActiveLeafCodec()`
     * （URL 只反映激活叶子，整树通过 history/hydration 旁路）。
     */
    readonly codec?: NavigationCodec;
    /** 导航级 beforeLoad 守卫（控制器对主目标执行，叠加在全局/路由守卫之外）。 */
    readonly beforeLoad?: readonly BeforeLoadGuard[];
    /** 导航级 afterLoad 守卫。 */
    readonly afterLoad?: readonly AfterLoadGuard[];
    /** dispatch 失败 / deny 时的兜底错误页工厂（仅 CSR runner 直接消费；SSR runner 用其自带的 getErrorPage）。 */
    readonly getErrorPage?: (status: number, message: string) => BasePage;
}

/**
 * `defineNavigation` 的产物：规范化后的导航定义。
 *
 * 既暴露规范化字段（应用可自取），也提供两个适配器把定义转成各 runner 需要的精确形态。
 * 字段全部 `readonly`、不可变。
 */
export interface NavigationDefinition {
    /** 规范化的初始结构（静态树或工厂）。 */
    readonly initial: NavigationInitial;
    /** 最终生效的 codec（已套用默认值）。 */
    readonly codec: NavigationCodec;
    /** 导航级 beforeLoad 守卫。 */
    readonly beforeLoad?: readonly BeforeLoadGuard[];
    /** 导航级 afterLoad 守卫。 */
    readonly afterLoad?: readonly AfterLoadGuard[];
    /** 兜底错误页工厂。 */
    readonly getErrorPage?: (status: number, message: string) => BasePage;
    /**
     * 适配为浏览器 runner 配置（`initial` 收敛为具体树）。
     * `initial` 是工厂时，对 `url`（缺省当前 `window.location`）求值；返回 `undefined`
     * 时回退到一个最小的占位 leaf（`@finesoft/navigation-root`），保证 bridge 能挂载——
     * 浏览器首屏随后会用 SSR 注入的真实树 hydrate（见 navigation-bridge）。
     */
    toBrowserConfig(url?: string): NavigationBrowserConfig;
    /** 适配为 SSR runner 定义（`initial` 收敛为骨架工厂、`codec` 必填）。 */
    toSSRDefinition(): NavigationSSRDefinition;
}

/** CSR 首屏在工厂返回 undefined 时的占位根 leaf intent（随后由 hydrate 替换）。 */
const NAVIGATION_ROOT_FALLBACK_INTENT = "@finesoft/navigation-root";

/** 任意值是否为合法的 NavigationNode（用于区分「静态树」与「工厂函数」）。 */
function isNavigationNode(value: NavigationInitial): value is NavigationNode {
    if (typeof value !== "object" || value === null) return false;
    return (
        isLeafNode(value as NavigationNode) ||
        isStackNode(value as NavigationNode) ||
        isTabsNode(value as NavigationNode) ||
        isSplitNode(value as NavigationNode)
    );
}

/** 把 `initial`（树或工厂）求值为具体树；工厂返回 undefined 时回退占位根 leaf。 */
function resolveInitialTree(initial: NavigationInitial, url: string): NavigationNode {
    if (isNavigationNode(initial)) return initial;
    const produced = initial(url);
    if (produced !== undefined) return produced;
    return { kind: "leaf", intent: NAVIGATION_ROOT_FALLBACK_INTENT, params: {} };
}

/** 把 `initial`（树或工厂）规范为 SSR 期望的骨架工厂（静态树 → 恒返回该树的工厂）。 */
function toInitialFactory(initial: NavigationInitial): (url: string) => NavigationNode | undefined {
    if (isNavigationNode(initial)) {
        return () => initial;
    }
    return initial;
}

/** 读取浏览器当前 URL（path + query）；非浏览器环境回退 `"/"`。 */
function currentBrowserUrl(): string {
    if (typeof window !== "undefined" && window.location) {
        return window.location.pathname + window.location.search;
    }
    return "/";
}

/**
 * 声明结构化导航。
 *
 * 在 `bootstrap(framework)` 里与 `defineRoutes` 并列调用，返回一个 `NavigationDefinition`，
 * 由应用分别交给 CSR / SSR runner：
 *
 * @example
 * ```ts
 * const nav = defineNavigation({
 *   initial: tabs({
 *     active: "home",
 *     branches: { home: stack(leaf("home")), me: stack(leaf("me")) },
 *   }),
 *   beforeLoad: [authGuard],
 * });
 *
 * // CSR
 * startBrowserApp({ bootstrap, mount, callbacks, navigation: nav.toBrowserConfig() });
 * // SSR
 * createSSRNavigationRender({ bootstrap, getErrorPage, renderApp, navigation: nav.toSSRDefinition() });
 * ```
 */
export function defineNavigation(options: DefineNavigationOptions): NavigationDefinition {
    const codec = options.codec ?? createActiveLeafCodec();
    const { initial, beforeLoad, afterLoad, getErrorPage } = options;

    return {
        initial,
        codec,
        beforeLoad,
        afterLoad,
        getErrorPage,
        toBrowserConfig(url?: string): NavigationBrowserConfig {
            return {
                initial: resolveInitialTree(initial, url ?? currentBrowserUrl()),
                codec,
                beforeLoad,
                afterLoad,
                getErrorPage,
            };
        },
        toSSRDefinition(): NavigationSSRDefinition {
            return {
                codec,
                initial: toInitialFactory(initial),
                beforeLoad,
                afterLoad,
            };
        },
    };
}
