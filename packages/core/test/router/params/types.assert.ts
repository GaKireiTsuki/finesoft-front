import { int, list, oneOf, optional, str, withDefault } from "../../../src/router/params";
import type {
    ExtractParamNames,
    InferParams,
    InferQuery,
    ParamsFor,
} from "../../../src/router/params";

type Expect<T extends true> = T;
type Equal<A, B> =
    (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// — ExtractParamNames —
type _Names1 = Expect<Equal<ExtractParamNames<"/product/:id">, "id">>;
type _Names2 = Expect<Equal<ExtractParamNames<"/post/:slug/:page?">, "slug" | "page">>;
type _Names3 = Expect<Equal<ExtractParamNames<"/">, never>>;
type _Names4 = Expect<Equal<ExtractParamNames<"/product/:id/reviews">, "id">>;

// — InferParams：optional → 可选键（undefined 值的 key 渲染为可选属性，且剥掉冗余的 | undefined） —
const sample = { id: int(), tab: optional(oneOf(["a", "b"] as const)) };
type _Infer = Expect<Equal<InferParams<typeof sample>, { id: number; tab?: "a" | "b" }>>;

// — withDefault 始终有值 → key 保持必选 —
const sample2 = { id: int(), count: withDefault(int(), 1) };
type _Infer2 = Expect<Equal<InferParams<typeof sample2>, { id: number; count: number }>>;

// — InferQuery：同样把 optional 的 key 渲染为可选属性 —
const q = { page: withDefault(int(), 1), sort: optional(oneOf(["asc", "desc"] as const)) };
type _InferQ = Expect<Equal<InferQuery<typeof q>, { page: number; sort?: "asc" | "desc" }>>;

// — InferQuery：多值 query（list）推导为数组 —
const qMulti = { tags: list(str()), ids: list(int()) };
type _InferQMulti = Expect<Equal<InferQuery<typeof qMulti>, { tags: string[]; ids: number[] }>>;

// — 6c 一致性：合法 key 通过 —
const okParams: ParamsFor<"/product/:id"> = { id: int() };

// — 6c 一致性：非法 key 报错（path 无 :slug） —
// @ts-expect-error - "slug" is not a parameter of "/product/:id"
const badParams: ParamsFor<"/product/:id"> = { slug: str() };

// 引用以避免 noUnusedLocals（即便将来开启）
void okParams;
void badParams;
