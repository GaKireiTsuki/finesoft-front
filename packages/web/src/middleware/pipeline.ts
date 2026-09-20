/**
 * Guard Pipeline — 顺序执行守卫链
 *
 * 按注册顺序执行守卫，遇到第一个非 `next` 结果立即短路返回。
 */

import { ExecutionError } from "@finesoft/core";
import type { MiddlewareResult, NavigationContext, PostLoadContext } from "./types";

async function runGuards<C extends NavigationContext>(
    guards: ((ctx: C) => MiddlewareResult | Promise<MiddlewareResult>)[],
    ctx: C,
): Promise<MiddlewareResult> {
    for (const guard of guards) {
        if (ctx.signal?.aborted) throw new ExecutionError("cancelled");
        const result = await guard(ctx);
        if (ctx.signal?.aborted) throw new ExecutionError("cancelled");
        if (result.kind !== "next") return result;
    }
    return { kind: "next" };
}

/** 执行 beforeLoad 守卫链 */
export const runBeforeLoadGuards = runGuards<NavigationContext>;

/** 执行 afterLoad 守卫链 */
export const runAfterLoadGuards = runGuards<PostLoadContext>;
