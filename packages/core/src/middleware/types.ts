/**
 * Navigation Middleware — 类型定义
 *
 * 两阶段导航中间件管线：
 * 1. beforeLoad — 路由匹配后、数据加载前（认证守卫、权限检查、早期重定向）
 * 2. afterLoad  — 数据加载后、渲染前（URL 规范化、基于数据的守卫）
 *
 * SSR 和 CSR 共享同一套中间件定义。
 */

import type { Container } from "../dependencies/container";
import type { Intent } from "../intents/types";
import type { BasePage } from "../models/page";

// =====================================================================
// Navigation Context — 中间件上下文
// =====================================================================

/** 导航上下文（beforeLoad 阶段可用） */
export interface NavigationContext {
	/** 完整 URL（path + query） */
	readonly url: string;
	/** 仅路径部分 */
	readonly path: string;
	/** 路由参数 + 查询参数 */
	readonly params: Record<string, string>;
	/** 匹配的 Intent */
	readonly intent: Intent;
	/** 是否在服务端运行 */
	readonly isServer: boolean;
	/** DI 容器（可获取自定义服务） */
	readonly container: Container;
	/** 获取 Cookie 值（两端均可用） */
	getCookie(name: string): string | undefined;
	/** 获取请求头值（仅服务端有值，客户端始终返回 undefined） */
	getHeader(name: string): string | undefined;
}

/** 后置上下文（afterLoad 阶段，包含页面数据） */
export interface PostLoadContext extends NavigationContext {
	/** 控制器返回的页面数据 */
	readonly page: BasePage;
}

// =====================================================================
// Middleware Result — 中间件返回值
// =====================================================================

/** 继续执行下一个中间件 */
export interface NextResult {
	readonly kind: "next";
}

/** 重定向（服务端: HTTP 301/302，客户端: 触发新导航） */
export interface RedirectResult {
	readonly kind: "redirect";
	readonly url: string;
	readonly status: number;
}

/** URL 重写（服务端: HTTP 301，客户端: replaceState 仅更新地址栏） */
export interface RewriteResult {
	readonly kind: "rewrite";
	readonly url: string;
}

/** 拒绝访问 */
export interface DenyResult {
	readonly kind: "deny";
	readonly status: number;
	readonly message: string;
}

export type MiddlewareResult =
	| NextResult
	| RedirectResult
	| RewriteResult
	| DenyResult;

// =====================================================================
// 便捷工厂函数
// =====================================================================

/** 继续执行 */
export function next(): NextResult {
	return { kind: "next" };
}

/** 重定向到新 URL */
export function redirect(url: string, status: 301 | 302 = 302): RedirectResult {
	return { kind: "redirect", url, status };
}

/** URL 重写（不重新加载数据） */
export function rewrite(url: string): RewriteResult {
	return { kind: "rewrite", url };
}

/** 拒绝访问 */
export function deny(status = 403, message = "Forbidden"): DenyResult {
	return { kind: "deny", status, message };
}

// =====================================================================
// Guard 函数类型
// =====================================================================

/** beforeLoad 守卫：路由匹配后、数据加载前 */
export type BeforeLoadGuard = (
	ctx: NavigationContext,
) => MiddlewareResult | Promise<MiddlewareResult>;

/** afterLoad 守卫：数据加载后、渲染前 */
export type AfterLoadGuard = (
	ctx: PostLoadContext,
) => MiddlewareResult | Promise<MiddlewareResult>;
