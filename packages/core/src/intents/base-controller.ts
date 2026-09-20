/**
 * BaseController — 抽象 Intent Controller 基类
 *
 * 提供标准化的 try/catch → fallback 模式。
 * 子类只需实现 execute() 和可选的 fallback()。
 */

import { ExecutionError, type ExecutionContext } from "../application/types";

/**
 * 抽象 Controller 基类
 *
 * 统一处理:
 * - 类型安全的输入 (TParams)
 * - 返回类型约束 (TResult)
 * - try/catch 错误处理 + 可选 fallback
 *
 * @example
 * ```ts
 * class ProductController extends BaseController<{ productId: string }, ProductPage> {
 *   readonly intentId = "product-page";
 *
 *   async execute(params: { productId: string }, container: Container) {
 *     const api = container.resolve<ApiClient>("api");
 *     return api.getProduct(params.productId);
 *   }
 *
 *   fallback(params: { productId: string }, error: Error) {
 *     return getMockProduct(params.productId);
 *   }
 * }
 * ```
 */
export abstract class BaseController<
    TParams extends Record<string, unknown> = Record<string, unknown>,
    TResult = unknown,
> {
    /**
     * 执行业务逻辑 — 子类必须实现
     *
     * @param input - 已类型化的操作输入
     * @param context - 当前执行上下文
     * @returns 页面数据
     */
    abstract execute(input: TParams, context: ExecutionContext): Promise<TResult> | TResult;

    /**
     * 错误回退 — 子类可选覆写
     *
     * 当 execute() 抛出异常时调用。
     * 默认行为: 重新抛出原始错误。
     *
     * @param input - 操作输入
     * @param error - execute() 抛出的错误
     * @returns 回退数据
     */
    fallback(input: TParams, error: Error, _context: ExecutionContext): Promise<TResult> | TResult {
        throw error;
    }

    /**
     * 自动 try/catch → fallback 模式。
     */
    async perform(input: TParams, context: ExecutionContext): Promise<TResult> {
        try {
            context.signal.throwIfAborted();
            const result = await this.execute(input, context);
            context.signal.throwIfAborted();
            return result;
        } catch (e) {
            if (
                context.signal.aborted ||
                (e instanceof Error && e.name === "AbortError") ||
                (e instanceof ExecutionError && e.code === "cancelled")
            )
                throw e;
            return this.fallback(input, e instanceof Error ? e : new Error(String(e)), context);
        }
    }
}
