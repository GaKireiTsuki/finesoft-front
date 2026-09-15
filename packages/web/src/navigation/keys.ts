/** Resource key helpers. `entryKey` is a temporary compatibility helper, never page identity. */
import { stableStringify } from "@finesoft/core";
import type { RouteParams } from "../router/types";

export function entryKey(intent: string, params: RouteParams): string {
    return `${intent} ${stableStringify(params)}`;
}

/** Resource identity never identifies a page instance. */
export function resourceKey(
    intent: string,
    params: RouteParams,
    partition: { identity?: string; locale?: string } = {},
): string {
    return stableStringify([intent, partition.identity ?? null, partition.locale ?? null, params]);
}
