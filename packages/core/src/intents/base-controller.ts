/**
 * BaseController — 抽象 Intent Controller 基类
 *
 * 提供标准化的 try/catch → fallback 模式。
 * 子类只需实现 execute() 和可选的 fallback()。
 */

import type { Container } from "../dependencies/container";
import type { Intent, IntentController } from "./types";

/**
 * 抽象 Controller 基类
 *
 * 统一处理:
 * - 类型安全的参数提取 (TParams)
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
    TParams extends Record<string, string | undefined> = Record<string, string>,
    TResult = unknown,
> implements IntentController<TResult> {
    /** Controller 对应的 Intent ID */
    abstract readonly intentId: string;

    /**
     * 执行业务逻辑 — 子类必须实现
     *
     * @param params - Intent 参数（已类型化）
     * @param container - DI 容器
     * @returns 页面数据
     */
    abstract execute(params: TParams, container: Container): Promise<TResult> | TResult;

    /**
     * 错误回退 — 子类可选覆写
     *
     * 当 execute() 抛出异常时调用。
     * 默认行为: 重新抛出原始错误。
     *
     * @param params - Intent 参数
     * @param error - execute() 抛出的错误
     * @returns 回退数据
     */
    fallback(params: TParams, error: Error): Promise<TResult> | TResult {
        throw error;
    }

    /**
     * IntentController.perform() 实现
     *
     * 自动 try/catch → fallback 模式。
     */
    async perform(intent: Intent<TResult>, container: Container): Promise<TResult> {
        const params = (intent.params ?? {}) as TParams;
        try {
            return await this.execute(params, container);
        } catch (e) {
            return this.fallback(params, e instanceof Error ? e : new Error(String(e)));
        }
    }
}
