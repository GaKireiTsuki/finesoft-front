import { isMultiValueSchema, type MultiValueSchema } from "./multi";
import type { ParamSchema } from "./standard";

type Schema<T> = ParamSchema<T> | MultiValueSchema<T>;

function onMissing<T>(codec: Schema<T>, fallback: T): Schema<T> {
    const multi = isMultiValueSchema(codec);
    return {
        ...(multi ? { multi: true as const } : {}),
        "~standard": {
            version: 1,
            vendor: "finesoft",
            validate(value) {
                if (value === undefined || (multi && Array.isArray(value) && value.length === 0))
                    return { value: fallback };
                return codec["~standard"].validate(value);
            },
        },
    };
}

/** 输入缺失（undefined）时跳过校验、产出 undefined；否则委托内部 codec（同步或异步均可）。 */
export function optional<T>(codec: MultiValueSchema<T>): MultiValueSchema<T | undefined>;
export function optional<T>(codec: ParamSchema<T>): ParamSchema<T | undefined>;
export function optional<T>(codec: Schema<T>): Schema<T | undefined> {
    return onMissing<T | undefined>(codec, undefined);
}

/** 输入缺失时用 fallback；否则委托内部 codec。 */
export function withDefault<T>(codec: MultiValueSchema<T>, fallback: T): MultiValueSchema<T>;
export function withDefault<T>(codec: ParamSchema<T>, fallback: T): ParamSchema<T>;
export function withDefault<T>(codec: Schema<T>, fallback: T): Schema<T> {
    return onMissing(codec, fallback);
}
