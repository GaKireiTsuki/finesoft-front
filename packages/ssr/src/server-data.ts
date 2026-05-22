/**
 * serializeServerData — 将 PrefetchedIntents 数据序列化为安全的 JSON
 *
 * 输出可安全嵌入 `<script type="application/json">` 标签：HTML 特殊字符全部
 * Unicode-escape；行分隔符避免破坏 JS 解析；marker 字段按白名单裁剪 page 对象。
 */

import { BASE_PAGE_FIELDS, getPublicFields, type PrefetchedIntent } from "@finesoft/core";

const LINE_SEPARATOR = " ";
const PARAGRAPH_SEPARATOR = " ";

const HTML_REPLACEMENTS: Record<string, string> = {
    "<": "\\u003C",
    ">": "\\u003E",
    "/": "\\u002F",
    [LINE_SEPARATOR]: "\\u2028",
    [PARAGRAPH_SEPARATOR]: "\\u2029",
};

// 构造 regex 时用 \uXXXX 转义，避免源码中直接写 U+2028 字面量 —— 部分 parser
// （oxc/swc）会把它当 line terminator 报语法错。
const HTML_ESCAPE_PATTERN = new RegExp("[<>/\\u2028\\u2029]", "g");

let unmarkedPageWarned = false;

export interface SerializeServerDataOptions {
    /**
     * 没有 `markPublic` 标注的 page 怎么处理：
     *
     * - `"all"` (默认): 全字段序列化 + dev 启动后打印一次告警。向后兼容。
     * - `"base-fields"`: 只保留 BasePage 标准字段 (id/pageType/title/description/url)。
     *   下一个 major 会成为默认。
     * - `"strict"`: 直接抛错。CI / 类型严格的场景用。
     */
    onUnmarkedPage?: "all" | "base-fields" | "strict";
}

export function serializeServerData(
    data: PrefetchedIntent[],
    options: SerializeServerDataOptions = {},
): string {
    const mode = options.onUnmarkedPage ?? "all";
    const sanitized = data.map((entry) => sanitizeIntent(entry, mode));
    const json = JSON.stringify(sanitized);
    return json.replace(HTML_ESCAPE_PATTERN, (match) => HTML_REPLACEMENTS[match] ?? match);
}

function sanitizeIntent(
    entry: PrefetchedIntent,
    mode: "all" | "base-fields" | "strict",
): PrefetchedIntent {
    const page = entry.data;
    const marker = getPublicFields(page);

    if (marker === true) return entry; // 显式 opt-out，原样
    if (Array.isArray(marker)) {
        return {
            ...entry,
            data: pick(page as Record<string, unknown>, marker) as typeof entry.data,
        };
    }

    // 未标注 —— 按 onUnmarkedPage 决定
    if (mode === "strict") {
        throw new Error(
            `[serializeServerData] page for intent "${entry.intent.id}" has no markPublic marker; ` +
                `wrap it with markPublic(page, ["field", ...]) to declare client-visible fields.`,
        );
    }
    if (mode === "base-fields") {
        return {
            ...entry,
            data: pick(page as Record<string, unknown>, BASE_PAGE_FIELDS) as typeof entry.data,
        };
    }
    warnUnmarkedPageOnce(entry.intent.id);
    return entry;
}

function pick(obj: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
        if (f in obj) out[f] = obj[f];
    }
    return out;
}

function warnUnmarkedPageOnce(intentId: string): void {
    if (unmarkedPageWarned) return;
    unmarkedPageWarned = true;
    if (!isDev()) return;
    console.warn(
        `[finesoft/ssr] Page for intent "${intentId}" was serialized without markPublic(); all fields ` +
            `(including any sensitive data) are exposed in the SSR HTML. Wrap your page with ` +
            `markPublic(page, ["field", ...]) to declare client-visible fields explicitly. ` +
            `The next major version will default to BasePage-only fields when no marker is present.`,
    );
}

function isDev(): boolean {
    try {
        const env = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env
            ?.NODE_ENV;
        return env !== "production";
    } catch {
        return false;
    }
}
