/**
 * Session — 快照编码 / 解码
 *
 * `encodeSnapshot` 用 `stableStringify` 产出确定性字符串（相同内容 → 相同输出，利于去重 / 对比）。
 * `decodeSnapshot` 做 `JSON.parse` + 结构校验 + 版本检查：任何异常（缺字段 / 类型错 / 版本不符 /
 * 畸形 JSON / `undefined`）一律返回 `undefined`，**绝不把异常抛进调用方** —— 旧态恢复失败不应崩应用。
 */

import { stableStringify } from "../prefetched-intents/stable-stringify";
import type { SessionSnapshot } from "./types";

/** 把快照编码为确定性字符串（keys 排序），用作 `storage.set` 的值。 */
export function encodeSnapshot(snapshot: SessionSnapshot): string {
    return stableStringify(snapshot);
}

/**
 * 解码并校验快照。
 *
 * 校验：`version === expectedVersion`、`slices`/`scoped` 为对象、`capturedAt` 为数值；
 * `navigation` 可缺省。任一不符或解析失败 → `undefined`（永不抛）。
 */
export function decodeSnapshot(
    raw: string | undefined,
    expectedVersion: number,
): SessionSnapshot | undefined {
    if (raw === undefined) return undefined;

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return undefined;
    }

    if (!isPlainObject(parsed)) return undefined;
    if (parsed.version !== expectedVersion) return undefined;
    if (typeof parsed.capturedAt !== "number") return undefined;
    if (!isPlainObject(parsed.slices)) return undefined;
    if (!isPlainObject(parsed.scoped)) return undefined;

    return parsed as unknown as SessionSnapshot;
}

/** 普通对象判别（排除 null 与数组）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
