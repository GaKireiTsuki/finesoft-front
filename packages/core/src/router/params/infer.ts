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

/** query 参数 codec map：key 自由开放 */
export type QuerySchemaMap = Record<string, StandardSchemaV1<string, unknown>>;

/** 从 codec map 推导运行期参数类型 */
export type InferParams<P extends Record<string, StandardSchemaV1>> = {
    [K in keyof P]: InferOutput<P[K]>;
};
export type InferQuery<Q extends QuerySchemaMap> = {
    [K in keyof Q]: InferOutput<Q[K]>;
};
