/**
 * Island 条目类型 + 共享标记构造器（UI 无关，core 单点拥有）。
 *
 * `ResolvedEntry` 是交给挂载/渲染原语的单条目解析结果（客户端 mountEntry / 服务端 renderEntry 共用）。
 * `islandContainerAttributes` 是 island 容器标记的来源 —— 客户端 orchestrator 建容器、服务端
 * `renderIslandsHtml` 拼字符串都用它，保证 server↔client 标记一致（水合按 `data-fs-key` 匹配）。
 */

import type { BasePage } from "../models/page";
import type { RouteParams } from "../router/types";

/** 交给挂载/渲染原语的单条目解析结果。 */
export interface ResolvedEntry {
    readonly intent: string;
    readonly params: RouteParams;
    readonly entryKey: string;
    readonly page: BasePage;
    /**
     * SSR 水合提示：true = 该条目的容器已含服务端渲染标记，挂载原语应**水合**（如 Vue
     * `createSSRApp().mount()`）而非新建（`createApp().mount()`）。缺省 false（新建）。
     */
    readonly hydrate?: boolean;
}

/**
 * island 容器的标记属性 —— 客户端 orchestrator 与服务端 helper 的单一来源。
 * `data-fs-entry`（标识容器）、`data-fs-intent`、`data-fs-key`（水合按它匹配）。
 */
export function islandContainerAttributes(
    intent: string,
    entryKey: string,
): Record<string, string> {
    return { "data-fs-entry": "", "data-fs-intent": intent, "data-fs-key": entryKey };
}
