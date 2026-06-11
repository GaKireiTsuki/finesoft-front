/**
 * 导航条目稳定身份键 —— controller 的 destinationKey 与 session 的 sessionEntryKey 的单一来源。
 * `intent` + 单个 ASCII 空格 + `stableStringify(params)`（params 键有序，故 {a,b} 与 {b,a} 同键）。
 */
import { stableStringify } from "../prefetched-intents/stable-stringify";
import type { RouteParams } from "../router/types";

export function entryKey(intent: string, params: RouteParams): string {
    return `${intent} ${stableStringify(params)}`;
}
