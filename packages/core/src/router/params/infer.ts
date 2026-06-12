import type { MultiValueSchema } from "./multi";
import type { InferOutput, ParamSchema, StandardSchemaV1 } from "./standard";

/** 剥离可选参数尾随的 "?" */
export type StripOptional<S extends string> = S extends `${infer N}?` ? N : S;

/** 从 path pattern 字面量提取参数名联合（处理 :param 与 :param?） */
export type ExtractParamNames<Path extends string> = Path extends `${infer _Head}:${infer Rest}`
    ? Rest extends `${infer Name}/${infer Tail}`
        ? StripOptional<Name> | ExtractParamNames<`/${Tail}`>
        : StripOptional<Rest>
    : never;

/** path 参数 codec map 的形状：key 只能是 path 中出现的参数名（均可选声明） */
export type ParamsFor<Path extends string> = {
    [K in ExtractParamNames<Path>]?: ParamSchema;
};

/** query 参数 codec map：key 自由开放；值可为单值 codec 或多值（list）codec */
export type QuerySchemaMap = Record<
    string,
    StandardSchemaV1<string, unknown> | MultiValueSchema<unknown>
>;

/** 把对象类型「拍平」为单层，便于阅读与类型相等比较 */
type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** 输出类型含 undefined 的 key（由 optional() 产生）→ 渲染为可选属性 */
type OptionalOutKeys<M extends Record<string, StandardSchemaV1>> = {
    [K in keyof M]: undefined extends InferOutput<M[K]> ? K : never;
}[keyof M];
type RequiredOutKeys<M extends Record<string, StandardSchemaV1>> = {
    [K in keyof M]: undefined extends InferOutput<M[K]> ? never : K;
}[keyof M];

/**
 * 从 codec map 推导运行期参数类型。
 * optional() 让输出含 undefined 的 key 渲染为可选属性（`tab?: T`，并剥掉冗余的 `| undefined`）；
 * withDefault() 始终有值，key 保持必选。
 */
export type InferParams<P extends Record<string, ParamSchema>> = Prettify<
    { [K in RequiredOutKeys<P>]: InferOutput<P[K]> } & {
        [K in OptionalOutKeys<P>]?: Exclude<InferOutput<P[K]>, undefined>;
    }
>;
export type InferQuery<Q extends QuerySchemaMap> = Prettify<
    { [K in RequiredOutKeys<Q>]: InferOutput<Q[K]> } & {
        [K in OptionalOutKeys<Q>]?: Exclude<InferOutput<Q[K]>, undefined>;
    }
>;
