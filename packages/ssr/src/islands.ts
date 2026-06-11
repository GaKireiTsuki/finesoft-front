/**
 * renderIslandsHtml —— 服务端把可见 island 渲成带共享标记的 HTML，供应用放进 outlet。
 *
 * 对快照里**每个可见目标**调应用 `renderEntry(entry)=>html`（mountEntry 的 SSR 平行物），用 core
 * 的 `islandContainerAttributes` 包成 `<div data-fs-entry ...>...</div>`，按 destinations 顺序拼接。
 * 标记与客户端 orchestrator 同源 → 浏览器按 `data-fs-key` 收养水合。
 */

import {
    islandContainerAttributes,
    sessionEntryKey,
    type NavigationSnapshot,
    type ResolvedEntry,
} from "@finesoft/core";

/** 应用提供：把一个目标渲成 HTML（mountEntry 的 SSR 平行物）。可异步（容纳 Vue renderToString）。 */
export type RenderEntry = (entry: ResolvedEntry) => string | Promise<string>;

/** 属性表 → HTML 属性串（空值产出布尔属性；值做最小转义）。 */
function serializeAttrs(attrs: Record<string, string>): string {
    return Object.entries(attrs)
        .map(([k, v]) => (v === "" ? k : `${k}="${escapeAttr(v)}"`))
        .join(" ");
}

function escapeAttr(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * 渲染快照里所有可见目标为 outlet 内的 island HTML 串。
 * 无可见目标 → 空串；`renderEntry` 按 destinations 顺序依次 await（顺序对 split 多列有意义）。
 */
export async function renderIslandsHtml(
    snapshot: NavigationSnapshot,
    renderEntry: RenderEntry,
): Promise<string> {
    const parts: string[] = [];
    for (const dest of snapshot.destinations) {
        const entryKey = sessionEntryKey(dest.intent, dest.params);
        const entry: ResolvedEntry = {
            intent: dest.intent,
            params: dest.params,
            entryKey,
            page: dest.page,
        };
        const inner = await renderEntry(entry);
        const attrs = serializeAttrs(islandContainerAttributes(dest.intent, entryKey));
        parts.push(`<div ${attrs}>${inner}</div>`);
    }
    return parts.join("");
}
