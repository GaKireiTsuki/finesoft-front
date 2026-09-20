import { stableStringify } from "@finesoft/core";
import type { RouteParams } from "../router/types";

/** Resource identity never identifies a page instance. */
export function resourceKey(
    intent: string,
    params: RouteParams,
    partition: { identity?: string; locale?: string } = {},
    query?: RouteParams,
): string {
    return stableStringify([
        intent,
        partition.identity ?? null,
        partition.locale ?? null,
        params,
        ...(query && Object.keys(query).length ? [query] : []),
    ]);
}
