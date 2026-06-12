import { defineRoute, defineRoutes, route } from "../../src/bootstrap/define-routes";
import type { Framework } from "../../src/framework";
import { int, oneOf, optional, str } from "../../src/router/params";

// — route() 单数 helper 的 6c —
// 合法：id 是 "/product/:id" 的参数
const ok = route("/product/:id", { intentId: "product", params: { id: int() } });

// 非法：slug 不是 "/product/:id" 的参数 → 编译期报错
// @ts-expect-error - "slug" is not a parameter of "/product/:id"
const bad = route("/product/:id", { intentId: "product", params: { slug: str() } });

void ok;
void bad;

// — defineRoutes 数组形态的 6c（每条路由按其自身 path 字面量约束 params 的 key）—
declare const framework: Framework;

// 合法：数组对象形态，id 是 "/product/:id" 的参数
defineRoutes(framework, [{ path: "/product/:id", intentId: "product", params: { id: int() } }]);

// 合法：可与无 params 的普通路由、route() 输出混用
defineRoutes(framework, [
    { path: "/", intentId: "home" },
    route("/product/:id", { intentId: "product", params: { id: int() } }),
]);

// 非法：数组形态下 slug 也应被 path 字面量拒绝
defineRoutes(framework, [
    // @ts-expect-error - "slug" is not a parameter of "/product/:id"
    { path: "/product/:id", intentId: "product", params: { slug: str() } },
]);

// — defineRoute：handler 的 params 类型从 path + codec 自动推导（免手写 InferParams<typeof>）—
defineRoute("/product/:id", {
    intentId: "product",
    params: { id: int() },
    query: { sort: optional(oneOf(["asc", "desc"] as const)) },
    handler: (params) => {
        const _id: number = params.id; // :id（int）→ number（必选）
        const _sort: "asc" | "desc" | undefined = params.sort; // query sort（optional）→ 可选 union
        const _omitSort: typeof params = { id: 1 }; // sort 可省略（可选键）
        // @ts-expect-error - id 必选，不能省略
        const _omitId: typeof params = { sort: "asc" };
        return { _id, _sort, _omitSort, _omitId };
    },
});

// defineRoute 非法 params key 同样被 path 字面量拒绝
defineRoute("/product/:id", {
    intentId: "product",
    // @ts-expect-error - "slug" is not a parameter of "/product/:id"
    params: { slug: str() },
    handler: () => ({}),
});
