import { makeSchema, type ParamSchema, type StandardResult } from "./standard";

const fail = (message: string): StandardResult<never> => ({ issues: [{ message }] });

export interface StrOptions {
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
}

export function str(opts: StrOptions = {}): ParamSchema<string> {
    return makeSchema<string>((value) => {
        if (typeof value !== "string") return fail("expected a string");
        if (opts.minLength !== undefined && value.length < opts.minLength)
            return fail(`must be at least ${opts.minLength} characters`);
        if (opts.maxLength !== undefined && value.length > opts.maxLength)
            return fail(`must be at most ${opts.maxLength} characters`);
        if (opts.pattern && !opts.pattern.test(value)) return fail(`must match ${opts.pattern}`);
        return { value };
    });
}

export interface NumOptions {
    min?: number;
    max?: number;
}

function inRange(n: number, opts: NumOptions): StandardResult<number> | null {
    if (opts.min !== undefined && n < opts.min) return fail(`must be >= ${opts.min}`);
    if (opts.max !== undefined && n > opts.max) return fail(`must be <= ${opts.max}`);
    return null;
}

export function int(opts: NumOptions = {}): ParamSchema<number> {
    return makeSchema<number>((value) => {
        if (typeof value !== "string" || !/^-?\d+$/.test(value))
            return fail(`"${value}" is not an integer`);
        const n = Number(value);
        return inRange(n, opts) ?? { value: n };
    });
}

export function num(opts: NumOptions = {}): ParamSchema<number> {
    return makeSchema<number>((value) => {
        if (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value))
            return fail(`"${value}" is not a number`);
        const n = Number(value);
        return inRange(n, opts) ?? { value: n };
    });
}

const TRUE = new Set(["true", "1"]);
const FALSE = new Set(["false", "0"]);

export function bool(): ParamSchema<boolean> {
    return makeSchema<boolean>((value) => {
        if (typeof value === "string" && TRUE.has(value)) return { value: true };
        if (typeof value === "string" && FALSE.has(value)) return { value: false };
        return fail(`"${value}" is not a boolean (true/false/1/0)`);
    });
}

export function oneOf<const T extends readonly string[]>(values: T): ParamSchema<T[number]> {
    return makeSchema<T[number]>((value) => {
        if (typeof value === "string" && (values as readonly string[]).includes(value))
            return { value: value as T[number] };
        return fail(`"${value}" is not one of: ${values.join(", ")}`);
    });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuid(): ParamSchema<string> {
    return makeSchema<string>((value) => {
        if (typeof value === "string" && UUID_RE.test(value)) return { value };
        return fail(`"${value}" is not a valid UUID`);
    });
}
