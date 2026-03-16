/**
 * Mapper 类型工具 — 标准化数据转换管线
 *
 * 提供类型约定和组合函数，让 API 响应 → 页面模型 的转换有统一的签名模式。
 */

/** 同步映射函数 */
export type Mapper<TInput, TOutput> = (input: TInput) => TOutput;

/** 异步映射函数 */
export type AsyncMapper<TInput, TOutput> = (input: TInput) => TOutput | Promise<TOutput>;

/**
 * 组合两个同步 Mapper: A → B → C
 */
export function pipe<A, B, C>(m1: Mapper<A, B>, m2: Mapper<B, C>): Mapper<A, C>;
/**
 * 组合三个同步 Mapper: A → B → C → D
 */
export function pipe<A, B, C, D>(
    m1: Mapper<A, B>,
    m2: Mapper<B, C>,
    m3: Mapper<C, D>,
): Mapper<A, D>;
/**
 * 组合四个同步 Mapper: A → B → C → D → E
 */
export function pipe<A, B, C, D, E>(
    m1: Mapper<A, B>,
    m2: Mapper<B, C>,
    m3: Mapper<C, D>,
    m4: Mapper<D, E>,
): Mapper<A, E>;
/**
 * 组合任意数量的同步 Mapper
 */
export function pipe(...mappers: Mapper<unknown, unknown>[]): Mapper<unknown, unknown>;
export function pipe(...mappers: Mapper<unknown, unknown>[]): Mapper<unknown, unknown> {
    return (input: unknown) => mappers.reduce((acc, mapper) => mapper(acc), input);
}

/**
 * 组合两个可能异步的 Mapper: A → B → C
 */
export function pipeAsync<A, B, C>(m1: AsyncMapper<A, B>, m2: AsyncMapper<B, C>): AsyncMapper<A, C>;
/**
 * 组合三个可能异步的 Mapper
 */
export function pipeAsync<A, B, C, D>(
    m1: AsyncMapper<A, B>,
    m2: AsyncMapper<B, C>,
    m3: AsyncMapper<C, D>,
): AsyncMapper<A, D>;
export function pipeAsync(
    ...mappers: AsyncMapper<unknown, unknown>[]
): AsyncMapper<unknown, unknown> {
    return async (input: unknown) => {
        let acc = input;
        for (const mapper of mappers) {
            acc = await mapper(acc);
        }
        return acc;
    };
}

/**
 * 将一个 Mapper 应用到数组的每个元素
 */
export function mapEach<TInput, TOutput>(
    mapper: Mapper<TInput, TOutput>,
): Mapper<TInput[], TOutput[]> {
    return (items) => items.map(mapper);
}
