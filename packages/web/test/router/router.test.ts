import { describe, expect, test, vi } from "vite-plus/test";
import { makeFlowAction } from "../../src/actions/types";
import { bool, int, list, optional, str, withDefault } from "@finesoft/core";
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
            params: { id: "42" },
            query: { sort: "asc" },
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

    test("keeps query separate from omitted optional path parameters", async () => {
        const router = new Router();
        router.add("/users/:id?", "users");

        expect((await router.resolve("/users?id=42"))?.intent).toEqual({
            id: "users",
            params: {},
            query: { id: "42" },
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

    test("publishes structured definitions and reverse routes", () => {
        const router = new Router();
        router.add("/products/:id", "product");
        expect(router.hasIntent("product")).toBe(true);
        expect(router.getDefinitions()).toMatchObject([
            {
                pattern: "/products/:id",
                intentId: "product",
                path: { parameters: [{ name: "id" }] },
            },
        ]);
        expect(router.reverse("product", { id: "a/b" }, { tab: "details" })).toBe(
            "/products/a%2Fb?tab=details",
        );
    });

    test("round-trips typed query lists, escaped values, and scalar defaults", async () => {
        const router = new Router().add("/products/:id", "product", {
            paramCodecs: { id: int() },
            queryCodecs: {
                q: withDefault(str(), ""),
                ids: optional(list(int())),
                tags: list(str()),
                enabled: list(bool()),
            },
        });
        const query = {
            q: "空 格&+",
            ids: [2, 1, 2],
            tags: ["a&b", "", "c+d"],
            enabled: [true, false],
        };
        const url = router.reverse("product", { id: 42 }, query)!;
        expect(new URL(url, "http://localhost").searchParams.getAll("ids")).toEqual([
            "2",
            "1",
            "2",
        ]);
        expect((await router.resolve(url))?.intent).toEqual({
            id: "product",
            params: { id: 42 },
            query,
        });
        expect((await router.resolve("/products/42"))?.intent.query).toEqual({
            q: "",
            ids: undefined,
            tags: [],
            enabled: [],
        });
        expect(await router.resolve("/products/42?ids=bad")).toBeNull();
    });

    test("defaulted query lists keep multi-value validation and only default missing keys", async () => {
        const router = new Router().add("/search", "search", {
            queryCodecs: { ids: withDefault(list(int()), [7]), q: withDefault(str(), "all") },
        });
        expect((await router.resolve("/search"))?.intent.query).toEqual({ ids: [7], q: "all" });
        expect((await router.resolve("/search?ids=1&ids=2&q="))?.intent.query).toEqual({
            ids: [1, 2],
            q: "",
        });
        expect(await router.resolve("/search?ids=")).toBeNull();
    });

    test("stores URL params in null-prototype records to avoid prototype pollution", async () => {
        const router = new Router();
        router.add("/products/:id", "product");

        const match = await router.resolve("/products/42?__proto__=polluted&toString=string-value");
        const params = match?.intent.params;

        expect(params).toBeDefined();
        expect(Object.getPrototypeOf(params)).toBeNull();
        expect(params?.id).toBe("42");
        const query = match?.intent.query;
        expect(Object.getPrototypeOf(query)).toBeNull();
        expect(query?.["__proto__"]).toBe("polluted");
        expect(query?.["toString"]).toBe("string-value");
        expect(Object.hasOwn(query!, "__proto__")).toBe(true);
        expect(Object.hasOwn(query!, "toString")).toBe(true);
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

        expect((await router.resolve("/search?page=2"))?.intent.query).toEqual({ page: 2 });
        expect(await router.resolve("/search?page=0")).toBeNull();
    });

    test("keeps undeclared query params as strings (backward compatible)", async () => {
        const router = new Router();
        router.add("/search", "search", { queryCodecs: { page: int() } });

        const match = await router.resolve("/search?page=2&q=hello");
        expect(match?.intent.query).toEqual({ page: 2, q: "hello" });
    });

    test("collects multi-value query params via list() codec", async () => {
        const router = new Router();
        router.add("/search", "search", { queryCodecs: { tags: list(str()) } });

        const match = await router.resolve("/search?tags=a&tags=b");
        expect(match?.intent.query).toEqual({ tags: ["a", "b"] });
    });

    test("list() query with a single value still yields an array", async () => {
        const router = new Router();
        router.add("/search", "search", { queryCodecs: { tags: list(str()) } });

        expect((await router.resolve("/search?tags=solo"))?.intent.query).toEqual({
            tags: ["solo"],
        });
    });

    test("list() query absent yields an empty array", async () => {
        const router = new Router();
        router.add("/search", "search", { queryCodecs: { tags: list(str()) } });

        expect((await router.resolve("/search"))?.intent.query).toEqual({ tags: [] });
    });

    test("list() item codec rejection falls through", async () => {
        const router = new Router();
        router.add("/feed/:id", "feed", { queryCodecs: { pages: list(int({ min: 1 })) } });

        expect(await router.resolve("/feed/1?pages=2&pages=0")).toBeNull();
    });

    test("logs a debug message when a route is skipped due to codec failure", async () => {
        const messages: string[] = [];
        const router = new Router((m) => messages.push(m));
        router.add("/product/:id", "product", { paramCodecs: { id: int() } });

        expect(await router.resolve("/product/abc")).toBeNull();
        expect(messages.some((m) => m.includes("/product/:id") && m.includes("id"))).toBe(true);
    });
});
