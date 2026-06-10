/**
 * Standard Schema v1 接口的最小本地声明 + 运行助手。
 * 纯 type-level 规范 + 运行时鸭子类型，不依赖 @standard-schema/spec 运行时包。
 * https://standardschema.dev
 */

export interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly "~standard": {
        readonly version: 1;
        readonly vendor: string;
        readonly validate: (
            value: unknown,
        ) => StandardResult<Output> | Promise<StandardResult<Output>>;
        readonly types?: { readonly input: Input; readonly output: Output };
    };
}

export type StandardResult<Output> =
    | { readonly value: Output; readonly issues?: undefined }
    | { readonly issues: ReadonlyArray<StandardIssue> };

export interface StandardIssue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

/** 提取 Standard Schema 的输出类型 */
export type InferOutput<S extends StandardSchemaV1> = NonNullable<
    S["~standard"]["types"]
>["output"];

/** 路由参数 codec：输入恒为 string（缺失时 undefined），输出为目标类型 T */
export type ParamSchema<T = unknown> = StandardSchemaV1<string, T>;

/** 工厂：从一个 validate 函数构造实现了 ~standard 的 codec */
export function makeSchema<T>(
    validate: (value: unknown) => StandardResult<T> | Promise<StandardResult<T>>,
): ParamSchema<T> {
    return {
        "~standard": {
            version: 1,
            vendor: "finesoft",
            validate,
        },
    };
}

/** 统一执行任意 Standard Schema 的校验，吸收同步/异步差异 */
export async function runStandard(
    schema: StandardSchemaV1,
    raw: string | undefined,
): Promise<{ ok: true; value: unknown } | { ok: false; issues: readonly StandardIssue[] }> {
    const result = await schema["~standard"].validate(raw);
    if (result.issues) return { ok: false, issues: result.issues };
    return { ok: true, value: result.value };
}
