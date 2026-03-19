/**
 * serializeServerData — 将 PrefetchedIntents 数据序列化为安全的 JSON
 *
 * 返回值可安全嵌入 <script> 标签。
 * 当提供 i18n 参数时，翻译数据一并序列化供客户端自动 hydrate。
 */

import type { PrefetchedIntent } from "@finesoft/core";

const HTML_REPLACEMENTS: Record<string, string> = {
    "<": "\\u003C",
    ">": "\\u003E",
    "/": "\\u002F",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029",
};

const HTML_ESCAPE_PATTERN = /[<>/\u2028\u2029]/g;

export function serializeServerData(
    data: PrefetchedIntent[],
    i18n?: { locale: string; messages: Record<string, string> },
): string {
    const payload = i18n ? { intents: data, i18n } : data;
    const json = JSON.stringify(payload);
    return json.replace(HTML_ESCAPE_PATTERN, (match) => HTML_REPLACEMENTS[match] ?? match);
}
