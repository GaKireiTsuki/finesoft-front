/**
 * BaseController — 抽象 Intent Controller 基类
 *
 * 提供标准化的 try/catch → fallback 模式。
 * 子类只需实现 execute() 和可选的 fallback()。
 */

import { ExecutionError, type ExecutionContext } from "../application/types";

export interface ControllerInput<
    TParams extends Record<string, unknown> = Record<string, unknown>,
    TQuery extends Record<string, unknown> = Record<string, unknown>,
> {
    readonly params: TParams;
    readonly query: TQuery;
    readonly context: ExecutionContext;
}

// perform supplies only these three fields; extra required fields cannot be fulfilled.
type InputFor<T extends ControllerInput> = T extends ControllerInput
    ? ControllerInput<T["params"], T["query"]> extends T
        ? T
        : never
    : never;
export interface ControllerFailure<
    TParams extends Record<string, unknown> = Record<string, unknown>,
    TQuery extends Record<string, unknown> = Record<string, unknown>,
> extends ControllerInput<TParams, TQuery> {
    readonly error: Error;
}

/**
 * 抽象 Controller 基类
 *
 * 统一处理:
 * - 类型安全的输入 (ControllerInput)
 * - 返回类型约束 (TResult)
 * - try/catch 错误处理 + 可选 fallback
 *
 * 路由生成的输入可直接使用 BaseController<Input, Result>。
 *
 * @example
 * ```ts
 * const API = createToken<ApiClient>("api");
 *
 * type Input = ControllerInput<{ productId: string }>;
 * class ProductController extends BaseController<Input, ProductPage> {
 *   async execute({ params, context }: Input) {
 *     const api = await context.get(API);
 *     return api.getProduct(params.productId);
 *   }
 *
 *   fallback({ params }: ControllerFailure<{ productId: string }>) {
 *     return getMockProduct(params.productId);
 *   }
 * }
 * ```
 */
export abstract class BaseController<
    TInput extends ControllerInput = ControllerInput,
    TResult = unknown,
> {
    /**
     * 执行业务逻辑 — 子类必须实现
     *
     * @param input - 分离的 params、query 和执行 context
     * @returns 页面数据
     */
    abstract execute(input: InputFor<TInput>): Promise<TResult> | TResult;

    /**
     * 错误回退 — 子类可选覆写
     *
     * 当 execute() 抛出异常时调用。
     * 默认行为: 重新抛出原始错误。
     *
     * @param input - 操作输入与 execute() 抛出的 error
     * @returns 回退数据
     */
    fallback({ error }: InputFor<TInput> & { readonly error: Error }): Promise<TResult> | TResult {
        throw error;
    }

    /**
     * 自动 try/catch → fallback 模式。
     */
    async perform(
        params: InputFor<TInput>["params"],
        context: ExecutionContext,
        ...query: {} extends InputFor<TInput>["query"]
            ? [query?: InputFor<TInput>["query"]]
            : [query: InputFor<TInput>["query"]]
    ): Promise<TResult> {
        const input = {
            params,
            query: query[0] ?? {},
            context,
        } as InputFor<TInput>;
        try {
            context.signal.throwIfAborted();
            const result = await this.execute(input);
            context.signal.throwIfAborted();
            return result;
        } catch (e) {
            if (
                context.signal.aborted ||
                (e instanceof Error && e.name === "AbortError") ||
                (e instanceof ExecutionError && e.code === "cancelled")
            )
                throw e;
            const error = e instanceof Error ? e : new Error(String(e));
            return this.fallback({ ...input, error });
        }
    }
}
