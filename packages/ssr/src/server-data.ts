/**
 * serializeServerData — 将 PrefetchedIntents 数据序列化为安全的 JSON
 *
 * 返回值可安全嵌入 <script> 标签。
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

export function serializeServerData(data: PrefetchedIntent[]): string {
	const json = JSON.stringify(data);
	return json.replace(
		HTML_ESCAPE_PATTERN,
		(match) => HTML_REPLACEMENTS[match] ?? match,
	);
}
