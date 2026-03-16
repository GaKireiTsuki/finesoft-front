/**
 * Server Data (browser side) — 从 DOM 反序列化服务端嵌入数据
 */

import { PrefetchedIntents, type PrefetchedIntent } from "@finesoft/core";

/** DOM 中嵌入数据的 script 标签 ID */
export const SERVER_DATA_ID = "serialized-server-data";

/**
 * 从 DOM 反序列化服务端嵌入的数据。
 * 读取 `<script id="serialized-server-data">` 的内容并移除标签。
 */
export function deserializeServerData(): PrefetchedIntent[] | undefined {
    const script = document.getElementById(SERVER_DATA_ID);
    if (!script?.textContent) return undefined;

    script.parentNode?.removeChild(script);

    try {
        return JSON.parse(script.textContent);
    } catch {
        return undefined;
    }
}

/**
 * 从 DOM 提取 SSR 数据并构建 PrefetchedIntents 实例。
 * 替代原来的 PrefetchedIntents.fromDom()。
 */
export function createPrefetchedIntentsFromDom(): PrefetchedIntents {
    const data = deserializeServerData();
    if (!data || !Array.isArray(data)) {
        return PrefetchedIntents.empty();
    }
    return PrefetchedIntents.fromArray(data);
}
