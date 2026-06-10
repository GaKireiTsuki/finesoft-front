import { describe, expect, test, vi } from "vite-plus/test";
import { makeFlowAction } from "../../src/actions/types";
import { int, str } from "../../src/router/params";
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

    test("logs a debug message when a route is skipped due to codec failure", async () => {
        const messages: string[] = [];
        const router = new Router((m) => messages.push(m));
        router.add("/product/:id", "product", { paramCodecs: { id: int() } });

        expect(await router.resolve("/product/abc")).toBeNull();
        expect(messages.some((m) => m.includes("/product/:id") && m.includes("id"))).toBe(true);
    });
});
