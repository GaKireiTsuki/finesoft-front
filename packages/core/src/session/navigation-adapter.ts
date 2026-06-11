/**
 * Session — 导航适配器（结构化 + 扁平）
 *
 * `SessionStore` 不直接依赖 `NavigationController`，只依赖 `SessionNavigationAdapter`
 * 这条接缝（见 `types.ts`）。本文件 ship 两个 helper，让扁平单页与结构化导航树经同一套
 * 机制覆盖：
 *
 * - `createNavigationSessionAdapter(controller)` —— **结构化**：`capture` 序列化整棵树，
 *   `apply` 把 `SerializedNavigation` 反序列化后 `hydrate` 回 controller，`presentKeys`
 *   收集树中**全部 leaf**（含不可见栈底、未激活分支）供 scoped prune。
 * - `createUrlSessionAdapter(opts)` —— **扁平**：`capture` 返回 `{ url }`，`apply` 调
 *   应用提供的 `navigate(url)`，`presentKeys` 恒为单条目（当前屏），故扁平单页天然只有
 *   「当前屏」一个作用域。
 *
 * 混合快照容错：结构化 `apply` 收到 `SessionUrlLocation` / `undefined` → no-op（结构化应用
 * 总捕获树）；扁平 `apply` 收到 `SerializedNavigation` → no-op（扁平只认 URL）。两者皆不抛。
 */

import { deserializeNavigation, serializeNavigation } from "../navigation";
import { collectLeafKeys, sessionEntryKey } from "./scoped-state";
import { isUrlLocation } from "./types";
import type { NavigationController } from "../navigation";
import type { RouteParams } from "../router/types";
import type { SessionNavigationAdapter, SessionSnapshot } from "./types";

/**
 * 结构化导航适配器：把 `NavigationController` 接到会话编排器。
 *
 * `apply` 仅处理 `SerializedNavigation`；`SessionUrlLocation` 与 `undefined` 一律 no-op
 * （结构化应用始终捕获一棵树，不会落到 URL 形态）。
 */
export function createNavigationSessionAdapter(
    controller: NavigationController,
): SessionNavigationAdapter {
    return {
        capture(): SessionSnapshot["navigation"] {
            return serializeNavigation(controller.getTree());
        },
        apply(navigation: SessionSnapshot["navigation"]): void | Promise<void> {
            if (navigation === undefined || isUrlLocation(navigation)) return undefined;
            return controller.hydrate(deserializeNavigation(navigation)).then(() => undefined);
        },
        presentKeys(): Iterable<string> {
            return collectLeafKeys(controller.getTree());
        },
    };
}

/** `createUrlSessionAdapter` 选项（扁平单页）。 */
export interface UrlAdapterOptions {
    /** 读取当前 URL（如 `() => location.pathname + location.search`）。 */
    readonly currentUrl: () => string;
    /** 应用恢复的 URL（应用提供，如 `framework.perform(makeFlowAction(url))`）。 */
    readonly navigate: (url: string) => void | Promise<void>;
    /** 可选：当前屏的 intent + params，用于 `presentKeys` 产出稳定身份键。 */
    readonly currentIntent?: () => { intent: string; params: RouteParams };
}

/**
 * 扁平 URL 适配器：把单页 URL 接到会话编排器。
 *
 * `apply` 仅处理 `SessionUrlLocation`；`SerializedNavigation` 与 `undefined` 一律 no-op
 * （扁平只认 URL 形态）。`presentKeys` 恒为单条目：有 `currentIntent` 时用
 * `sessionEntryKey(intent, params)`，否则退化为当前 URL 字符串。
 */
export function createUrlSessionAdapter(opts: UrlAdapterOptions): SessionNavigationAdapter {
    return {
        capture(): SessionSnapshot["navigation"] {
            return { url: opts.currentUrl() };
        },
        apply(navigation: SessionSnapshot["navigation"]): void | Promise<void> {
            if (!isUrlLocation(navigation)) return undefined;
            return opts.navigate(navigation.url);
        },
        presentKeys(): Iterable<string> {
            if (opts.currentIntent) {
                const { intent, params } = opts.currentIntent();
                return [sessionEntryKey(intent, params)];
            }
            return [opts.currentUrl()];
        },
    };
}
