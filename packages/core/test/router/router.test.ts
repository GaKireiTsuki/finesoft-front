import { describe, expect, test, vi } from "vite-plus/test";
import { makeFlowAction } from "../../src/actions/types";
import { Router } from "../../src/router/router";

describe("Router", () => {
    test("resolves dynamic routes, query params, render mode, and guards", () => {
        const router = new Router();
        const beforeGuards = [vi.fn()];
        const afterGuards = [vi.fn()];

        router.add("/products/:id", "product", {
            renderMode: "ssr",
            beforeGuards,
            afterGuards,
        });

        const match = router.resolve("/products/42?sort=asc");

        expect(match?.intent).toEqual({
            id: "product",
            params: {
                id: "42",
                sort: "asc",
            },
        });
        expect(match?.action).toEqual(makeFlowAction("/products/42?sort=asc"));
        expect(match?.renderMode).toBe("ssr");
        expect(match?.beforeGuards).toBe(beforeGuards);
        expect(match?.afterGuards).toBe(afterGuards);
    });

    test("supports optional params and strips URL hashes during parsing", () => {
        const router = new Router();
        router.add("/blog/:slug?", "blog");

        expect(router.resolve("/blog")?.intent).toEqual({
            id: "blog",
            params: {},
        });
        expect(router.resolve("/blog/hello#comments")?.intent).toEqual({
            id: "blog",
            params: { slug: "hello" },
        });
    });

    test("throws when duplicate param names are used in a route pattern", () => {
        const router = new Router();

        expect(() => router.add("/users/:id/:id", "bad-route")).toThrow(/Duplicate parameter/);
    });

    test("returns registered route summaries and null for misses", () => {
        const router = new Router();
        router.add("/", "home");
        router.add("/account/:tab?", "account");

        expect(router.getRoutes()).toEqual(["/ → home", "/account/:tab? → account"]);
        expect(router.resolve("/missing")).toBeNull();
    });

    test("stores URL params in null-prototype records to avoid prototype pollution", () => {
        const router = new Router();
        router.add("/products/:id", "product");

        const match = router.resolve("/products/42?__proto__=polluted&toString=string-value");
        const params = match?.intent.params;

        expect(params).toBeDefined();
        expect(Object.getPrototypeOf(params)).toBeNull();
        expect(params?.id).toBe("42");
        expect(params?.["__proto__"]).toBe("polluted");
        expect(params?.["toString"]).toBe("string-value");
        expect(Object.hasOwn(params!, "__proto__")).toBe(true);
        expect(Object.hasOwn(params!, "toString")).toBe(true);
    });
});
