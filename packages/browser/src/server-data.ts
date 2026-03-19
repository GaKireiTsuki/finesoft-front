/**
 * Server Data (browser side) — 从 DOM 反序列化服务端嵌入数据
 */

import { PrefetchedIntents, type PrefetchedIntent } from "@finesoft/core";

/** DOM 中嵌入数据的 script 标签 ID */
export const SERVER_DATA_ID = "serialized-server-data";

/** 解析后的服务端数据（含 intents 和可选的 i18n） */
interface ParsedServerData {
    intents: PrefetchedIntent[];
    i18n?: { locale: string; messages: Record<string, string> };
}

/** 缓存：脚本标签只能读一次（读后即移除），两个消费者共享 */
let cachedParsed: ParsedServerData | null | undefined;

function readAndParseServerData(): ParsedServerData | null {
    if (cachedParsed !== undefined) return cachedParsed;

    const script = document.getElementById(SERVER_DATA_ID);
    if (!script?.textContent) {
        cachedParsed = null;
        return null;
    }

    script.parentNode?.removeChild(script);

    try {
        const parsed = JSON.parse(script.textContent);
        // 兼容旧格式（纯数组）和新格式（{ intents, i18n? }）
        if (Array.isArray(parsed)) {
            cachedParsed = { intents: parsed };
        } else {
            cachedParsed = {
                intents: parsed.intents ?? [],
                i18n: parsed.i18n,
            };
        }
        return cachedParsed;
    } catch {
        cachedParsed = null;
        return null;
    }
}

/**
 * 从 DOM 反序列化服务端嵌入的数据。
 * 读取 `<script id="serialized-server-data">` 的内容并移除标签。
 */
export function deserializeServerData(): PrefetchedIntent[] | undefined {
    return readAndParseServerData()?.intents;
}

/**
 * 从 DOM 提取 SSR 传递的 i18n 翻译数据。
 * 与 deserializeServerData 共享同一份解析结果。
 */
export function extractI18nFromDom():
    | { locale: string; messages: Record<string, string> }
    | undefined {
    return readAndParseServerData()?.i18n;
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
