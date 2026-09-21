import type { Intent } from "@finesoft/core";

/** 路由参数：键为参数名，值为 codec 转换后的任意类型（string / number / boolean …）。 */
export type RouteParams = Record<string, unknown>;

/** Path and query share codecs, but retain separate names and values. */
export interface RouteInput {
    readonly params: RouteParams;
    readonly query: RouteParams;
}
export interface RouteIntent<T = unknown> extends Intent<T> {
    readonly query?: RouteParams;
}

/** Absent and empty query values share one cache identity. */
export function routeIntent<T = unknown>(
    id: string,
    params: RouteParams = {},
    query?: RouteParams,
): RouteIntent<T> {
    return { id, params, ...(query && Object.keys(query).length ? { query } : {}) };
}
