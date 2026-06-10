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
