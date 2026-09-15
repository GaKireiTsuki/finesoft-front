/**
 * 多值 query 参数（`?tag=a&tag=b` → `string[]`）。
 *
 * `list()` 产出的 codec 输入是 `string[]`（该 query key 的全部取值），与单值 codec
 * （输入 `string`）不同，故带一个运行时 `multi` 标记：`Router.resolve` 据此对该 key
 * 调 `searchParams.getAll(name)` 取全部值传入，而非单值。
 */

import type { ParamSchema, StandardResult, StandardSchemaV1 } from "./standard";

/** 多值（数组）query codec：输入为 string[]，并带 `multi` 运行时标记。 */
export interface MultiValueSchema<Output> extends StandardSchemaV1<string[], Output> {
    readonly multi: true;
}

export interface ListOptions {
    /** 最少元素数 */
    min?: number;
    /** 最多元素数 */
    max?: number;
}

/** 运行时判断一个 schema 是否为多值 codec（resolve 据此决定取全部值还是单值）。 */
export function isMultiValueSchema(schema: StandardSchemaV1): schema is MultiValueSchema<unknown> {
    return (schema as { multi?: unknown }).multi === true;
}

/**
 * 多值 query 原语：用内部单值 codec 逐项校验/转换，产出数组。
 * 缺失（undefined）→ 空数组；任一项校验失败 → 整体失败（resolve 据此 fall-through）。
 */
export function list<T>(item: ParamSchema<T>, opts: ListOptions = {}): MultiValueSchema<T[]> {
    return {
        multi: true,
        "~standard": {
            version: 1,
            vendor: "finesoft",
            validate: async (value): Promise<StandardResult<T[]>> => {
                const raw = value === undefined ? [] : Array.isArray(value) ? value : [value];
                const out: T[] = [];
                for (const v of raw) {
                    const res = await item["~standard"].validate(v);
                    if (res.issues) return { issues: res.issues };
                    out.push(res.value);
                }
                if (opts.min !== undefined && out.length < opts.min)
                    return { issues: [{ message: `must have at least ${opts.min} item(s)` }] };
                if (opts.max !== undefined && out.length > opts.max)
                    return { issues: [{ message: `must have at most ${opts.max} item(s)` }] };
                return { value: out };
            },
        },
    };
}
