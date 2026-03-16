/**
 * Guard Pipeline — 顺序执行守卫链
 *
 * 按注册顺序执行守卫，遇到第一个非 `next` 结果立即短路返回。
 */

import type {
	AfterLoadGuard,
	BeforeLoadGuard,
	MiddlewareResult,
	NavigationContext,
	PostLoadContext,
} from "./types";

/** 执行 beforeLoad 守卫链 */
export async function runBeforeLoadGuards(
	guards: BeforeLoadGuard[],
	ctx: NavigationContext,
): Promise<MiddlewareResult> {
	for (const guard of guards) {
		const result = await guard(ctx);
		if (result.kind !== "next") return result;
	}
	return { kind: "next" };
}

/** 执行 afterLoad 守卫链 */
export async function runAfterLoadGuards(
	guards: AfterLoadGuard[],
	ctx: PostLoadContext,
): Promise<MiddlewareResult> {
	for (const guard of guards) {
		const result = await guard(ctx);
		if (result.kind !== "next") return result;
	}
	return { kind: "next" };
}
