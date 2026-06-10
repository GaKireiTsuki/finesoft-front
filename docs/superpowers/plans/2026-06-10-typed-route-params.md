# 路由参数类型化（Typed Route Params）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给路由参数附加 codec（校验 + 类型转换 + 编译期类型推断），让 `Router.resolve` 在匹配后校验参数，失败则 fall-through 到 404。

**Architecture:** 内置零依赖原语自身实现 [Standard Schema v1](https://standardschema.dev) `~standard` 接口，与 zod/valibot 走同一条校验路径。`resolve`/`routeUrl` 改异步以支持异步校验。path 参数（`params`）与 query 参数（`query`）分字段；`route()` helper 从 path 字面量约束 `params` 的 key（6c 一致性）。

**Tech Stack:** TypeScript strict，Vite+（`vp`）工具链，Vitest（`vite-plus/test`）。

**对应 spec:** [docs/superpowers/specs/2026-06-10-typed-route-params-design.md](../specs/2026-06-10-typed-route-params-design.md)

---

## File Structure

新增（全部在 `@finesoft/core`）：

| 文件                                               | 职责                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/core/src/router/params/standard.ts`      | Standard Schema v1 本地类型别名 + `makeSchema` 工厂 + `runStandard` 助手    |
| `packages/core/src/router/params/primitives.ts`    | `str`/`int`/`num`/`bool`/`oneOf`/`uuid`                                     |
| `packages/core/src/router/params/modifiers.ts`     | `optional`/`withDefault`                                                    |
| `packages/core/src/router/params/infer.ts`         | `ExtractParamNames`/`ParamsFor`/`InferParams`/`InferQuery`/`QuerySchemaMap` |
| `packages/core/src/router/params/index.ts`         | barrel 导出                                                                 |
| `packages/core/test/router/params/*.test.ts`       | 原语/修饰器/standard 的运行时测试                                           |
| `packages/core/test/router/params/types.assert.ts` | 类型断言（靠 `vp check`/tsc 验证，非 vitest 用例）                          |

修改：

| 文件                                                             | 改动                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/core/src/router/router.ts`                             | `RouteAddOptions`/内部定义加 codec 字段；`resolve` 改 async + 校验 + fall-through |
| `packages/core/src/framework.ts:100`                             | `routeUrl` 改 async                                                               |
| `packages/core/src/intents/types.ts`                             | `Intent.params` → `Record<string, unknown>`                                       |
| `packages/core/src/intents/base-controller.ts`                   | `TParams` 约束放宽为 `Record<string, unknown>`                                    |
| `packages/core/src/bootstrap/define-routes.ts`                   | `RouteDefinition` 泛型化 + `params`/`query` 字段 + `route()` helper + 透传 codec  |
| `packages/core/src/index.ts`                                     | 导出 params 公共 API                                                              |
| `packages/browser/src/start-app.ts:147`                          | `await framework.routeUrl(...)`                                                   |
| `packages/browser/src/action-handlers/flow-action.ts:68/184/210` | `await framework.routeUrl(...)`                                                   |
| `packages/ssr/src/render.ts:149`                                 | `await framework.routeUrl(...)`                                                   |
| `templates/*/src/lib/controllers/product-detail.ts`              | 示范：`:id` 用 `int()`                                                            |

---

## Task 1: Standard Schema 类型 + makeSchema + runStandard

**Files:**

- Create: `packages/core/src/router/params/standard.ts`
- Test: `packages/core/test/router/params/standard.test.ts`

- [ ] **Step 1: 写 standard.ts**

```ts
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
    validate: (value: string | undefined) => StandardResult<T> | Promise<StandardResult<T>>,
): ParamSchema<T> {
    return {
        "~standard": {
            version: 1,
            vendor: "finesoft",
            validate: (value) => validate(value as string | undefined),
            types: undefined,
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
```

- [ ] **Step 2: 写失败测试**

`packages/core/test/router/params/standard.test.ts`：

```ts
import { describe, expect, test } from "vite-plus/test";
import { makeSchema, runStandard, type ParamSchema } from "../../../src/router/params/standard";

describe("makeSchema / runStandard", () => {
    const upper: ParamSchema<string> = makeSchema<string>((v) =>
        typeof v === "string" ? { value: v.toUpperCase() } : { issues: [{ message: "no" }] },
    );

    test("runs a sync schema and returns the transformed value", async () => {
        const r = await runStandard(upper, "abc");
        expect(r).toEqual({ ok: true, value: "ABC" });
    });

    test("reports issues on failure", async () => {
        const r = await runStandard(upper, undefined);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.issues[0].message).toBe("no");
    });

    test("awaits an async schema", async () => {
        const asyncUpper: ParamSchema<string> = makeSchema<string>(async (v) => ({
            value: String(v).toUpperCase(),
        }));
        const r = await runStandard(asyncUpper, "abc");
        expect(r).toEqual({ ok: true, value: "ABC" });
    });
});
```

- [ ] **Step 3: 跑测试确认通过**

Run: `vp test packages/core/test/router/params/standard.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/router/params/standard.ts packages/core/test/router/params/standard.test.ts
git commit -m "feat(core): add Standard Schema types + makeSchema/runStandard"
```

---

## Task 2: 内置原语 str/int/num/bool/oneOf/uuid

**Files:**

- Create: `packages/core/src/router/params/primitives.ts`
- Test: `packages/core/test/router/params/primitives.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/core/test/router/params/primitives.test.ts`：

```ts
import { describe, expect, test } from "vite-plus/test";
import { bool, int, num, oneOf, str, uuid } from "../../../src/router/params/primitives";
import { runStandard } from "../../../src/router/params/standard";

describe("primitives", () => {
    test("int: parses integers, rejects non-integers and empty", async () => {
        expect(await runStandard(int(), "42")).toEqual({ ok: true, value: 42 });
        expect(await runStandard(int(), "-7")).toEqual({ ok: true, value: -7 });
        expect((await runStandard(int(), "1.5")).ok).toBe(false);
        expect((await runStandard(int(), "abc")).ok).toBe(false);
        expect((await runStandard(int(), "")).ok).toBe(false);
    });

    test("int: enforces min/max", async () => {
        expect((await runStandard(int({ min: 1 }), "0")).ok).toBe(false);
        expect((await runStandard(int({ max: 9 }), "10")).ok).toBe(false);
        expect(await runStandard(int({ min: 1, max: 9 }), "5")).toEqual({ ok: true, value: 5 });
    });

    test("num: parses decimals, rejects junk", async () => {
        expect(await runStandard(num(), "3.14")).toEqual({ ok: true, value: 3.14 });
        expect((await runStandard(num(), "1e3")).ok).toBe(false);
    });

    test("bool: accepts true/false/1/0", async () => {
        expect(await runStandard(bool(), "true")).toEqual({ ok: true, value: true });
        expect(await runStandard(bool(), "0")).toEqual({ ok: true, value: false });
        expect((await runStandard(bool(), "yes")).ok).toBe(false);
    });

    test("oneOf: accepts members, rejects others", async () => {
        const s = oneOf(["asc", "desc"] as const);
        expect(await runStandard(s, "asc")).toEqual({ ok: true, value: "asc" });
        expect((await runStandard(s, "up")).ok).toBe(false);
    });

    test("str: enforces length and pattern", async () => {
        expect(await runStandard(str({ minLength: 1 }), "x")).toEqual({ ok: true, value: "x" });
        expect((await runStandard(str({ minLength: 1 }), "")).ok).toBe(false);
        expect((await runStandard(str({ pattern: /^[a-z]+$/ }), "AB")).ok).toBe(false);
    });

    test("uuid: validates UUID format", async () => {
        expect((await runStandard(uuid(), "550e8400-e29b-41d4-a716-446655440000")).ok).toBe(true);
        expect((await runStandard(uuid(), "not-a-uuid")).ok).toBe(false);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `vp test packages/core/test/router/params/primitives.test.ts`
Expected: FAIL（无法解析 `primitives` 模块）

- [ ] **Step 3: 写 primitives.ts**

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `vp test packages/core/test/router/params/primitives.test.ts`
Expected: PASS（7 个用例）

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/router/params/primitives.ts packages/core/test/router/params/primitives.test.ts
git commit -m "feat(core): add built-in param primitives (str/int/num/bool/oneOf/uuid)"
```

---

## Task 3: 修饰器 optional/withDefault

**Files:**

- Create: `packages/core/src/router/params/modifiers.ts`
- Test: `packages/core/test/router/params/modifiers.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/core/test/router/params/modifiers.test.ts`：

```ts
import { describe, expect, test } from "vite-plus/test";
import { int } from "../../../src/router/params/primitives";
import { optional, withDefault } from "../../../src/router/params/modifiers";
import { runStandard } from "../../../src/router/params/standard";

describe("modifiers", () => {
    test("optional: undefined input yields undefined value, no validation", async () => {
        expect(await runStandard(optional(int()), undefined)).toEqual({
            ok: true,
            value: undefined,
        });
    });

    test("optional: present input is delegated to inner codec", async () => {
        expect(await runStandard(optional(int()), "5")).toEqual({ ok: true, value: 5 });
        expect((await runStandard(optional(int()), "x")).ok).toBe(false);
    });

    test("withDefault: undefined input yields fallback", async () => {
        expect(await runStandard(withDefault(int(), 1), undefined)).toEqual({ ok: true, value: 1 });
    });

    test("withDefault: present input is delegated", async () => {
        expect(await runStandard(withDefault(int(), 1), "9")).toEqual({ ok: true, value: 9 });
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `vp test packages/core/test/router/params/modifiers.test.ts`
Expected: FAIL（无法解析 `modifiers` 模块）

- [ ] **Step 3: 写 modifiers.ts**

```ts
import { makeSchema, type ParamSchema } from "./standard";

/** 输入缺失（undefined）时跳过校验、产出 undefined；否则委托内部 codec。面向同步内置原语。 */
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `vp test packages/core/test/router/params/modifiers.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/router/params/modifiers.ts packages/core/test/router/params/modifiers.test.ts
git commit -m "feat(core): add optional/withDefault param modifiers"
```

---

## Task 4: 类型推断工具 + barrel + 类型断言

**Files:**

- Create: `packages/core/src/router/params/infer.ts`
- Create: `packages/core/src/router/params/index.ts`
- Test: `packages/core/test/router/params/types.assert.ts`

- [ ] **Step 1: 写 infer.ts**

```ts
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
```

- [ ] **Step 2: 写 index.ts barrel**

```ts
export { makeSchema, runStandard } from "./standard";
export type {
    InferOutput,
    ParamSchema,
    StandardIssue,
    StandardResult,
    StandardSchemaV1,
} from "./standard";
export { bool, int, num, oneOf, str, uuid } from "./primitives";
export type { NumOptions, StrOptions } from "./primitives";
export { optional, withDefault } from "./modifiers";
export type {
    ExtractParamNames,
    InferParams,
    InferQuery,
    ParamsFor,
    QuerySchemaMap,
    StripOptional,
} from "./infer";
```

- [ ] **Step 3: 写类型断言文件**

`packages/core/test/router/params/types.assert.ts`（无 `.test.` 后缀，不被 vitest 当用例；被 core tsconfig 的 `include: ["test"]` 编译）：

```ts
import { int, oneOf, optional, str } from "../../../src/router/params";
import type { ExtractParamNames, InferParams, ParamsFor } from "../../../src/router/params";

type Expect<T extends true> = T;
type Equal<A, B> =
    (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// — ExtractParamNames —
type _Names1 = Expect<Equal<ExtractParamNames<"/product/:id">, "id">>;
type _Names2 = Expect<Equal<ExtractParamNames<"/post/:slug/:page?">, "slug" | "page">>;
type _Names3 = Expect<Equal<ExtractParamNames<"/">, never>>;
type _Names4 = Expect<Equal<ExtractParamNames<"/product/:id/reviews">, "id">>;

// — InferParams —
const sample = { id: int(), tab: optional(oneOf(["a", "b"] as const)) };
type _Infer = Expect<Equal<InferParams<typeof sample>, { id: number; tab: "a" | "b" | undefined }>>;

// — 6c 一致性：合法 key 通过 —
const okParams: ParamsFor<"/product/:id"> = { id: int() };

// — 6c 一致性：非法 key 报错（path 无 :slug） —
// @ts-expect-error - "slug" is not a parameter of "/product/:id"
const badParams: ParamsFor<"/product/:id"> = { slug: str() };

// 引用以避免 noUnusedLocals（即便将来开启）
void okParams;
void badParams;
```

- [ ] **Step 4: 类型检查确认通过**

Run: `vp check`
Expected: 类型检查无错误。特别地，`badParams` 行的 `@ts-expect-error` 必须命中（若它变成「unused @ts-expect-error」错误，说明 `ParamsFor` 未约束非法 key，需检查 `ExtractParamNames`/`ParamsFor`）。

> 若 `vp check` 太慢，可临时用 `cd packages/core && npx tsc --noEmit -p tsconfig.json`（仅本任务调试用，提交前仍以 `vp check` 为准）。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/router/params/infer.ts packages/core/src/router/params/index.ts packages/core/test/router/params/types.assert.ts
git commit -m "feat(core): add param type inference utils + barrel + type assertions"
```

---

## Task 5: Router 接收 codec + resolve 异步化 + fall-through

**Files:**

- Modify: `packages/core/src/router/router.ts`
- Test: `packages/core/test/router/router.test.ts`

- [ ] **Step 1: 更新现有测试为 async（先让它们因签名变化而失败）**

把 `packages/core/test/router/router.test.ts` 中 5 个用例的 `resolve(...)` 调用改为 `await`，并把对应 `test("...", () => {...})` 改为 `test("...", async () => {...})`。完整替换文件内容为：

```ts
import { describe, expect, test, vi } from "vite-plus/test";
import { makeFlowAction } from "../../src/actions/types";
import { int, oneOf, str } from "../../src/router/params";
import { Router } from "../../src/router/router";

describe("Router", () => {
    test("resolves dynamic routes, query params, render mode, and guards", async () => {
        const router = new Router();
        const beforeGuards = [vi.fn()];
        const afterGuards = [vi.fn()];

        router.add("/products/:id", "product", {
            renderMode: "ssr",
            beforeGuards,
            afterGuards,
        });

        const match = await router.resolve("/products/42?sort=asc");

        expect(match?.intent).toEqual({
            id: "product",
            params: { id: "42", sort: "asc" },
        });
        expect(match?.action).toEqual(makeFlowAction("/products/42?sort=asc"));
        expect(match?.renderMode).toBe("ssr");
        expect(match?.beforeGuards).toBe(beforeGuards);
        expect(match?.afterGuards).toBe(afterGuards);
    });

    test("supports optional params and strips URL hashes during parsing", async () => {
        const router = new Router();
        router.add("/blog/:slug?", "blog");

        expect((await router.resolve("/blog"))?.intent).toEqual({ id: "blog", params: {} });
        expect((await router.resolve("/blog/hello#comments"))?.intent).toEqual({
            id: "blog",
            params: { slug: "hello" },
        });
    });

    test("throws when duplicate param names are used in a route pattern", () => {
        const router = new Router();
        expect(() => router.add("/users/:id/:id", "bad-route")).toThrow(/Duplicate parameter/);
    });

    test("returns registered route summaries and null for misses", async () => {
        const router = new Router();
        router.add("/", "home");
        router.add("/account/:tab?", "account");

        expect(router.getRoutes()).toEqual(["/ → home", "/account/:tab? → account"]);
        expect(await router.resolve("/missing")).toBeNull();
    });

    test("stores URL params in null-prototype records to avoid prototype pollution", async () => {
        const router = new Router();
        router.add("/products/:id", "product");

        const match = await router.resolve("/products/42?__proto__=polluted&toString=string-value");
        const params = match?.intent.params;

        expect(params).toBeDefined();
        expect(Object.getPrototypeOf(params)).toBeNull();
        expect(params?.id).toBe("42");
        expect(params?.["__proto__"]).toBe("polluted");
        expect(params?.["toString"]).toBe("string-value");
        expect(Object.hasOwn(params!, "__proto__")).toBe(true);
        expect(Object.hasOwn(params!, "toString")).toBe(true);
    });

    // ===== 新增：codec 校验 =====
    test("validates path params via codec and converts the value", async () => {
        const router = new Router();
        router.add("/product/:id", "product", { paramCodecs: { id: int() } });

        const match = await router.resolve("/product/42");
        expect(match?.intent.params).toEqual({ id: 42 }); // number, 已转换
    });

    test("falls through (returns null) when a path codec rejects", async () => {
        const router = new Router();
        router.add("/product/:id", "product", { paramCodecs: { id: int() } });

        expect(await router.resolve("/product/abc")).toBeNull();
    });

    test("supports overlapping routes by registration order (int then str)", async () => {
        const router = new Router();
        router.add("/item/:id", "item-by-id", { paramCodecs: { id: int() } });
        router.add("/item/:slug", "item-by-slug", { paramCodecs: { slug: str() } });

        expect((await router.resolve("/item/42"))?.intent.id).toBe("item-by-id");
        expect((await router.resolve("/item/hello"))?.intent.id).toBe("item-by-slug");
    });

    test("validates query params; rejection falls through", async () => {
        const router = new Router();
        router.add("/search", "search", { queryCodecs: { page: int({ min: 1 }) } });

        expect((await router.resolve("/search?page=2"))?.intent.params).toEqual({ page: 2 });
        expect(await router.resolve("/search?page=0")).toBeNull();
    });

    test("keeps undeclared query params as strings (backward compatible)", async () => {
        const router = new Router();
        router.add("/search", "search", { queryCodecs: { page: int() } });

        const match = await router.resolve("/search?page=2&q=hello");
        expect(match?.intent.params).toEqual({ page: 2, q: "hello" });
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `vp test packages/core/test/router/router.test.ts`
Expected: FAIL（`resolve` 仍同步、`paramCodecs`/`queryCodecs` 选项不存在、新用例失败）

- [ ] **Step 3: 改 router.ts**

把 `packages/core/src/router/router.ts` 改为（保留 `add` 的 regex 编译逻辑，替换 imports、`RouteAddOptions`、`InternalRouteDefinition`、`createNullPrototypeRecord`、`add` 内 push 字段、`resolve`）：

顶部 import 增加：

```ts
import { runStandard, type ParamSchema, type StandardSchemaV1 } from "./params/standard";
```

`RouteAddOptions` 增加两个字段：

```ts
export interface RouteAddOptions {
    renderMode?: string;
    beforeGuards?: BeforeLoadGuard[];
    afterGuards?: AfterLoadGuard[];
    paramCodecs?: Record<string, ParamSchema>;
    queryCodecs?: Record<string, StandardSchemaV1<string, unknown>>;
}
```

`InternalRouteDefinition` 增加两个字段：

```ts
interface InternalRouteDefinition {
    pattern: string;
    intentId: string;
    regex: RegExp;
    paramNames: string[];
    renderMode?: string;
    beforeGuards?: BeforeLoadGuard[];
    afterGuards?: AfterLoadGuard[];
    paramCodecs?: Record<string, ParamSchema>;
    queryCodecs?: Record<string, StandardSchemaV1<string, unknown>>;
}
```

`createNullPrototypeRecord` 泛型化（返回值放宽）：

```ts
function createNullPrototypeRecord<V = string>(source?: Record<string, V>): Record<string, V> {
    // 通过无原型目标对象复制，让 URL 控制的键保持惰性数据。
    return Object.assign(Object.create(null), source) as Record<string, V>;
}
```

`add` 的 `this.routes.push({...})` 增加两个字段（其余不变）：

```ts
this.routes.push({
    pattern,
    intentId,
    regex: new RegExp(`^${regexStr}/?$`),
    paramNames,
    renderMode: opts.renderMode,
    beforeGuards: opts.beforeGuards,
    afterGuards: opts.afterGuards,
    paramCodecs: opts.paramCodecs,
    queryCodecs: opts.queryCodecs,
});
```

`resolve` 整体替换为异步版：

```ts
    /** 解析 URL → RouteMatch（含参数校验；校验失败则 fall-through 到下一条路由） */
    async resolve(urlOrPath: string): Promise<RouteMatch | null> {
        const { path, queryParams } = this.parseUrl(urlOrPath);

        for (const route of this.routes) {
            const match = path.match(route.regex);
            if (!match) continue;

            const params = createNullPrototypeRecord<unknown>();
            let ok = true;

            // —— path 参数 ——
            for (let i = 0; i < route.paramNames.length; i++) {
                const name = route.paramNames[i];
                const raw = match[i + 1];
                const codec = route.paramCodecs?.[name];
                if (codec) {
                    const r = await runStandard(codec, raw);
                    if (!r.ok) {
                        ok = false;
                        break;
                    }
                    if (r.value !== undefined) params[name] = r.value;
                } else if (raw) {
                    params[name] = raw;
                }
            }
            if (!ok) continue;

            // —— query 参数：声明了 codec 的走校验 ——
            if (route.queryCodecs) {
                for (const name of Object.keys(route.queryCodecs)) {
                    const r = await runStandard(route.queryCodecs[name], queryParams[name]);
                    if (!r.ok) {
                        ok = false;
                        break;
                    }
                    if (r.value !== undefined) params[name] = r.value;
                }
            }
            if (!ok) continue;

            // —— 未声明 codec 的 query 参数：保持 string（向后兼容） ——
            for (const key of Object.keys(queryParams)) {
                if (!(key in params) && !route.queryCodecs?.[key]) {
                    params[key] = queryParams[key];
                }
            }

            return {
                intent: { id: route.intentId, params },
                action: makeFlowAction(urlOrPath),
                renderMode: route.renderMode,
                beforeGuards: route.beforeGuards,
                afterGuards: route.afterGuards,
            };
        }

        return null;
    }
```

`parseUrl` 内的 `createNullPrototypeRecord(...)` 调用保持不变（泛型默认 `V=string`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `vp test packages/core/test/router/router.test.ts`
Expected: PASS（原 5 个 + 新 5 个用例）

- [ ] **Step 5: 类型检查**

Run: `vp check`
Expected: 无类型错误（注意 `Intent.params` 此刻仍是 `Record<string,string>`，但 `resolve` 返回的 `params` 是 `Record<string,unknown>` —— 若此处报 `intent.params` 类型不符，Task 7 会放宽 `Intent.params`；本步骤可临时在返回处用 `params` 直接赋值，Task 7 完成后类型自洽。如报错，先继续 Task 7 再回跑 `vp check`。）

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/router/router.ts packages/core/test/router/router.test.ts
git commit -m "feat(core): async resolve with param codec validation + fall-through"
```

---

## Task 6: framework.routeUrl 异步化

**Files:**

- Modify: `packages/core/src/framework.ts:100-102`
- Test: `packages/core/test/framework.test.ts:80`

- [ ] **Step 1: 改 framework.ts**

把 `routeUrl` 改为 async：

```ts
    async routeUrl(url: string): Promise<RouteMatch | null> {
        return this.router.resolve(url);
    }
```

- [ ] **Step 2: 改 framework.test.ts 的调用点**

把 `packages/core/test/framework.test.ts:80` 附近的同步断言改为 await。原代码：

```ts
        expect(framework.routeUrl("/")?.intent).toEqual({
```

改为（并确保所在 `test` 回调是 `async`）：

```ts
        expect((await framework.routeUrl("/"))?.intent).toEqual({
```

- [ ] **Step 3: 跑测试确认通过**

Run: `vp test packages/core/test/framework.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/framework.ts packages/core/test/framework.test.ts
git commit -m "feat(core): make framework.routeUrl async"
```

---

## Task 7: Intent.params 与 BaseController TParams 放宽

**Files:**

- Modify: `packages/core/src/intents/types.ts:11`
- Modify: `packages/core/src/intents/base-controller.ts:36`
- Test: `packages/core/test/intents/*.test.ts`（回归）

- [ ] **Step 1: 改 Intent.params**

`packages/core/src/intents/types.ts`：

```ts
export interface Intent<T = unknown> {
    /** Intent 标识符（用于匹配 Controller） */
    id: string;
    /** 意图参数（path/query 经 codec 转换后可能是 number/boolean 等） */
    params?: Record<string, unknown>;
    /** 预期返回的数据（仅用于类型推断） */
    _returnType?: T;
}
```

- [ ] **Step 2: 改 BaseController 的 TParams 约束**

`packages/core/src/intents/base-controller.ts`，把类声明的泛型约束：

```ts
export abstract class BaseController<
    TParams extends Record<string, unknown> = Record<string, unknown>,
    TResult = unknown,
> implements IntentController<TResult> {
```

（`perform` 内 `const params = (intent.params ?? {}) as TParams;` 保持不变。）

- [ ] **Step 3: 跑受影响测试 + 全量类型检查**

Run: `vp test packages/core` 然后 `vp check`
Expected: PASS 且无类型错误（Task 5 Step 5 中遗留的 `intent.params` 类型问题此刻应消解）。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/intents/types.ts packages/core/src/intents/base-controller.ts
git commit -m "feat(core): widen Intent.params and BaseController TParams to unknown"
```

---

## Task 8: browser 调用点 await

**Files:**

- Modify: `packages/browser/src/start-app.ts:147`
- Modify: `packages/browser/src/action-handlers/flow-action.ts:68,184,210`
- Test: `packages/browser/test/...`（回归）

- [ ] **Step 1: 改 start-app.ts:147**

```ts
const initialAction = await framework.routeUrl(initialUrl);
```

- [ ] **Step 2: 改 flow-action.ts 三处**

`:68`（`navigateTo` 内）：

```ts
const match = await framework.routeUrl(url);
```

`:184`（FLOW handler 的 modal 分支内）：

```ts
const match = await framework.routeUrl(url);
```

`:210`（popstate handler 内）：

```ts
const routeMatch = await framework.routeUrl(parsed.pathname + parsed.search);
```

- [ ] **Step 3: 跑 browser 测试确认通过**

Run: `vp test packages/browser`
Expected: PASS。

> 运行时层面，`await` 一个同步 mock 返回值即得到该值，测试逻辑不变。若 `vp check` 报 mock 的 `routeUrl: vi.fn(() => X)` 与 `Promise<RouteMatch | null>` 返回类型不符，则把这些 mock 改为返回 Promise，例如 `routeUrl: vi.fn(() => Promise.resolve(X))`（对 `flow-action.test.ts` 与 `start-app.test.ts` 中所有 `routeUrl: vi.fn(...)` 应用同一模式）。

- [ ] **Step 4: 类型检查**

Run: `vp check`
Expected: 无类型错误（如有 mock 类型问题，按 Step 3 注记修正后重跑）。

- [ ] **Step 5: Commit**

```bash
git add packages/browser/src/start-app.ts packages/browser/src/action-handlers/flow-action.ts packages/browser/test
git commit -m "feat(browser): await async routeUrl at all call sites"
```

---

## Task 9: ssr 调用点 await

**Files:**

- Modify: `packages/ssr/src/render.ts:149`
- Test: `packages/ssr/test/...`（回归）

- [ ] **Step 1: 改 render.ts:149**

```ts
const match = await framework.routeUrl(fullPath);
```

- [ ] **Step 2: 跑 ssr 测试 + 类型检查**

Run: `vp test packages/ssr` 然后 `vp check`
Expected: PASS 且无类型错误。

- [ ] **Step 3: Commit**

```bash
git add packages/ssr/src/render.ts
git commit -m "feat(ssr): await async routeUrl in render"
```

---

## Task 10: RouteDefinition 泛型化 + route() helper + defineRoutes 透传

**Files:**

- Modify: `packages/core/src/bootstrap/define-routes.ts`
- Test: `packages/core/test/bootstrap/define-routes.test.ts`（运行时）
- Test: `packages/core/test/bootstrap/define-routes.assert.ts`（类型）

- [ ] **Step 1: 写运行时失败测试**

`packages/core/test/bootstrap/define-routes.test.ts`（若已存在则追加用例）：

```ts
import { describe, expect, test } from "vite-plus/test";
import { Framework } from "../../src/framework";
import { defineRoutes, route } from "../../src/bootstrap/define-routes";
import { int } from "../../src/router/params";
import { BaseController } from "../../src/intents/base-controller";
import type { Container } from "../../src/dependencies/container";

class ProductController extends BaseController<{ id: number }, { id: number }> {
    readonly intentId = "product";
    execute(params: { id: number }, _c: Container) {
        return { id: params.id };
    }
}

describe("defineRoutes + route() with codecs", () => {
    test("passes param codecs through to the router and converts values", async () => {
        const fw = Framework.create({});
        defineRoutes(fw, [
            route("/product/:id", {
                intentId: "product",
                controller: new ProductController(),
                params: { id: int() },
            }),
        ]);

        const match = await fw.routeUrl("/product/42");
        expect(match?.intent.params).toEqual({ id: 42 });

        expect(await fw.routeUrl("/product/abc")).toBeNull(); // 校验失败 → 404
    });
});
```

> 若 `Framework.create({})` 需要必填配置，参照 `packages/core/test/framework.test.ts` 现有的 `Framework.create(...)` 调用方式构造最小 config。

- [ ] **Step 2: 跑测试确认失败**

Run: `vp test packages/core/test/bootstrap/define-routes.test.ts`
Expected: FAIL（`route` 未导出 / `params` 字段未透传）

- [ ] **Step 3: 改 define-routes.ts**

顶部 import 增加：

```ts
import type { ParamSchema, ParamsFor, QuerySchemaMap } from "../router/params";
```

`RouteDefinition` 泛型化并增加 `params`/`query`：

```ts
export interface RouteDefinition<
    Path extends string = string,
    P extends ParamsFor<Path> = ParamsFor<Path>,
    Q extends QuerySchemaMap = QuerySchemaMap,
> {
    /** URL pattern (如 "/product/:id") */
    path: Path;
    /** Intent ID */
    intentId: string;
    /** Controller 实例（可选）。同一 intentId 的多条路由只需在第一条提供。 */
    controller?: IntentController;
    /** path 参数 codec；key 必须是 path 中出现的 :param 名 */
    params?: P;
    /** query 参数 codec；key 自由 */
    query?: Q;
    /** 渲染模式（可选，默认 "ssr"） */
    renderMode?: RenderMode;
    /** 路由级 beforeLoad 守卫 */
    beforeLoad?: BeforeLoadGuard[];
    /** 路由级 afterLoad 守卫 */
    afterLoad?: AfterLoadGuard[];
}
```

新增 `route()` helper（6c 一致性的可靠载体：单条路由从 `path` 字面量约束 `params` 的 key）：

```ts
/**
 * 构造一条强类型路由定义。
 * `params` 的 key 受 `path` 字面量约束——写入 path 中不存在的参数名会编译期报错。
 *
 * @example
 * route("/product/:id", { intentId: "product", controller, params: { id: int() } })
 */
export function route<
    const Path extends string,
    P extends ParamsFor<Path> = ParamsFor<Path>,
    Q extends QuerySchemaMap = QuerySchemaMap,
>(
    path: Path,
    def: {
        intentId: string;
        controller?: IntentController;
        params?: P;
        query?: Q;
        renderMode?: RenderMode;
        beforeLoad?: BeforeLoadGuard[];
        afterLoad?: AfterLoadGuard[];
    },
): RouteDefinition {
    return { path, ...def } as RouteDefinition;
}
```

`defineRoutes` 的 `definitions` 参数类型改为 `RouteDefinition[]`（保持运行时简单），并在 `routeOpts` 透传 codec：

```ts
const routeOpts = {
    renderMode: def.renderMode,
    beforeGuards: def.beforeLoad,
    afterGuards: def.afterLoad,
    paramCodecs: def.params as Record<string, ParamSchema> | undefined,
    queryCodecs: def.query,
};

// 注册原始路由（含路由级守卫与 codec）
framework.router.add(def.path, def.intentId, routeOpts);

// 注册 locale 前缀路由（:locale 由框架注入、保持 string，沿用同一 codec 集）
if (options?.locales?.length) {
    const localePath = def.path === "/" ? "/:locale" : `/:locale${def.path}`;
    framework.router.add(localePath, def.intentId, routeOpts);
}
```

（`defineRoutes` 函数签名保持 `definitions: RouteDefinition[]`，其余逻辑不变。）

- [ ] **Step 4: 跑运行时测试确认通过**

Run: `vp test packages/core/test/bootstrap/define-routes.test.ts`
Expected: PASS

- [ ] **Step 5: 写类型断言（验证 6c 经 route() 生效）**

`packages/core/test/bootstrap/define-routes.assert.ts`：

```ts
import { route } from "../../src/bootstrap/define-routes";
import { int, str } from "../../src/router/params";

// 合法：id 是 "/product/:id" 的参数
const ok = route("/product/:id", { intentId: "product", params: { id: int() } });

// 非法：slug 不是 "/product/:id" 的参数 → 编译期报错
// @ts-expect-error - "slug" is not a parameter of "/product/:id"
const bad = route("/product/:id", { intentId: "product", params: { slug: str() } });

void ok;
void bad;
```

- [ ] **Step 6: 类型检查确认通过**

Run: `vp check`
Expected: 无错误，且 `bad` 行的 `@ts-expect-error` 命中。

> **回退判定**：若 `@ts-expect-error` 报「unused」（即 `route()` 未约束非法 key），说明 `const Path` 字面量推断未生效——检查 `route` 的 `const Path extends string` 写法与 `ParamsFor<Path>` 是否正确链接；TS 应在 5.0+ 支持 `const` 类型参数。本仓 Node `>=22.12`、TS 经 vite-plus 提供，版本满足。

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/bootstrap/define-routes.ts packages/core/test/bootstrap/define-routes.test.ts packages/core/test/bootstrap/define-routes.assert.ts
git commit -m "feat(core): typed RouteDefinition + route() helper + codec passthrough"
```

---

## Task 11: core 导出面 + front 验证

**Files:**

- Modify: `packages/core/src/index.ts`
- Verify: `packages/front`（`export * from "@finesoft/core"` 自动带出）

- [ ] **Step 1: 在 core/src/index.ts 增加 params 导出**

在 `// ===== Router =====` 段落后新增：

```ts
// ===== Route Params (typed validation) =====
export {
    bool,
    int,
    makeSchema,
    num,
    oneOf,
    optional,
    runStandard,
    str,
    uuid,
    withDefault,
} from "./router/params";
export type {
    ExtractParamNames,
    InferOutput,
    InferParams,
    InferQuery,
    NumOptions,
    ParamSchema,
    ParamsFor,
    QuerySchemaMap,
    StandardIssue,
    StandardResult,
    StandardSchemaV1,
    StrOptions,
    StripOptional,
} from "./router/params";
export { route } from "./bootstrap/define-routes";
```

> 确认 `defineRoutes` 与 `RouteDefinition` 已在 index.ts 导出；若未导出则一并补 `export { defineRoutes } from "./bootstrap/define-routes";` 和 `export type { RouteDefinition, DefineRoutesOptions, RenderMode } from "./bootstrap/define-routes";`（依现有内容补缺，不重复导出）。

- [ ] **Step 2: 构建 core + front 验证导出**

Run: `vp run -r build`
Expected: 全部包构建成功，无 dts 错误。

- [ ] **Step 3: 烟雾验证 front 导出可用**

Run:

```bash
node -e "import('@finesoft/front').then(m => console.log(['int','str','oneOf','optional','route','defineRoutes'].map(k => k+':'+typeof m[k]).join(' ')))"
```

Expected: 形如 `int:function str:function oneOf:function optional:function route:function defineRoutes:function`

> 若 `@finesoft/front` 未链接到本地构建产物，改用 `node -e "import('./packages/front/dist/index.js').then(...)"`。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export typed route params public API"
```

---

## Task 12: 模板示范 + changeset

**Files:**

- Modify: `templates/{svelte,vue,react}/src/lib/{bootstrap,routes}.ts`（路由定义处）与 `controllers/product-detail.ts`
- Create: changeset

- [ ] **Step 1: 定位模板路由定义**

Run: `grep -rn "product\|:id\|defineRoutes" templates/svelte/src --include="*.ts"`
Expected: 找到 `defineRoutes([... { path: "/product/:id" 或类似 ...])` 的位置与 `product-detail` controller。

- [ ] **Step 2: 升级 product 路由用 int() + route()**

在三个模板（svelte/vue/react）的路由定义处，把 product 路由改为 `route()` 形式并加 `params: { id: int() }`。例如（按各模板实际 controller 名与导入路径微调）：

```ts
import { defineRoutes, route, int } from "@finesoft/front";

defineRoutes(framework, [
    // ...
    route("/product/:id", {
        intentId: "product",
        controller: new ProductDetailController(),
        params: { id: int() },
    }),
    // ...
]);
```

并把 `controllers/product-detail.ts` 的参数类型从 `{ id: string }` 改为 `{ id: number }`（`BaseController<{ id: number }, ...>`），移除手动 `params.id` 的字符串假设（模板里 `` `product-${params.id}` `` 等模板字符串对 number 同样有效，无需改动文案逻辑）。

- [ ] **Step 3: 跑模板类型检查 / 构建**

Run: `vp check`
Expected: 无类型错误。

> 模板不在覆盖率/CI 扫描范围，但仍应通过类型检查。若某模板的 `Framework`/controller 接线方式不同，按该模板既有写法对齐，不强行统一。

- [ ] **Step 4: 创建 changeset**

Run: `changeset`

- 选择 `@finesoft/front` 作为受影响包
- bump 类型：**minor**（新增能力 + `Intent.params`/`routeUrl` 的类型层 breaking，但运行时向后兼容；如团队约定将类型层 breaking 视为 major，则选 major）
- 摘要：

```
Add typed route params: built-in zero-dep param primitives (int/str/num/bool/oneOf/uuid)
implementing Standard Schema, plus support for any Standard Schema validator (zod/valibot).
route() helper enforces param-name consistency from the path literal. resolve()/routeUrl()
are now async; validation failure falls through to 404. Intent.params widened to unknown.
```

- [ ] **Step 5: Commit**

```bash
git add templates .changeset
git commit -m "feat: demo typed route params in templates + changeset"
```

---

## Self-Review

**1. Spec coverage（逐节核对 spec → task）：**

| spec 节                                                             | 覆盖 task                                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| §3.1 Standard Schema 统一契约                                       | Task 1                                                                                                                          |
| §3.2 内置原语 + 修饰器                                              | Task 2, 3                                                                                                                       |
| §3.3 RouteDefinition params/query 分字段                            | Task 10                                                                                                                         |
| §3.4 类型推断（ExtractParamNames/ParamsFor/InferParams/InferQuery） | Task 4；6c 经 Task 10 的 `route()`                                                                                              |
| §3.5 异步 resolve + 校验 + fall-through                             | Task 5                                                                                                                          |
| §3.6 失败语义 → 404                                                 | Task 5（fall-through 返回 null）+ Task 8/9（404 路径已存在，未改）                                                              |
| §5 改动清单（core/browser/ssr/front）                               | Task 5-11                                                                                                                       |
| §6 向后兼容（Intent.params 放宽、PrefetchedIntents）                | Task 7；PrefetchedIntents 命中由 Task 5 的「未声明 codec 保持 string」+ 同构 bootstrap 保证，Task 5/10 运行时测试覆盖转换一致性 |
| §7 安全（null-proto）                                               | Task 5（`createNullPrototypeRecord` 保留）+ router.test.ts 污染用例                                                             |
| §8 测试策略                                                         | Task 1-5、10 的测试步骤                                                                                                         |

无遗漏。`framework.routeUrl` 异步化（§5）= Task 6。

**2. Placeholder scan：** 无 TBD/TODO；所有代码步骤含完整代码；测试步骤含完整断言；命令含预期输出。Task 12 Step 2 因三模板接线各异，给出了模式 + 「按实际微调」指引而非逐文件死代码——这是对模板差异的诚实处理，非占位符。

**3. Type consistency（跨 task 命名核对）：**

- `makeSchema`/`runStandard`/`ParamSchema`/`StandardSchemaV1`/`StandardResult`/`StandardIssue`/`InferOutput`：Task 1 定义，Task 2/3/4/5 一致引用。
- `str`/`int`/`num`/`bool`/`oneOf`/`uuid`/`StrOptions`/`NumOptions`：Task 2 定义，barrel（Task 4）与导出（Task 11）一致。
- `optional`/`withDefault`：Task 3 定义，Task 4/11 一致。
- `ExtractParamNames`/`StripOptional`/`ParamsFor`/`QuerySchemaMap`/`InferParams`/`InferQuery`：Task 4 定义，Task 10/11 一致。
- `RouteAddOptions.paramCodecs`/`queryCodecs` 与 `InternalRouteDefinition` 字段：Task 5 一致。
- `route()` 签名与 `RouteDefinition<Path,P,Q>`：Task 10 定义，Task 11/12 一致引用。
- `Intent.params: Record<string, unknown>` 与 `BaseController<TParams extends Record<string, unknown>>`：Task 7 一致。

无签名漂移。

---

## Execution Handoff

见会话中的执行方式选择。
