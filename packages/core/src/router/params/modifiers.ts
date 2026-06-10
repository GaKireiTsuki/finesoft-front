import { makeSchema, type ParamSchema } from "./standard";

/** 输入缺失（undefined）时跳过校验、产出 undefined；否则委托内部 codec（同步或异步均可）。 */
export function optional<T>(codec: ParamSchema<T>): ParamSchema<T | undefined> {
    return makeSchema<T | undefined>((value) => {
        if (value === undefined) return { value: undefined };
        return codec["~standard"].validate(value);
    });
}

/** 输入缺失时用 fallback；否则委托内部 codec。 */
export function withDefault<T>(codec: ParamSchema<T>, fallback: T): ParamSchema<T> {
    return makeSchema<T>((value) => {
        if (value === undefined) return { value: fallback };
        return codec["~standard"].validate(value);
    });
}
