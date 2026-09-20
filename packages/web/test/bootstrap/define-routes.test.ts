import { routePages } from "../helpers/definition";
import { expect, test } from "vite-plus/test";
import { int, oneOf, optional } from "@finesoft/core";
import { route } from "../../src/bootstrap/define-routes";
import { defineWebApp } from "../../src/application/definition";
import { loadPage } from "../../src/application/load-page";
import { createWebRuntime } from "../../src/application/runtime";
test("immutable route declarations decode path and query through the definition owner", async () => {
    const product = route("/product/:id", {
        intentId: "product",
        params: { id: int() },
        query: { sort: optional(oneOf(["asc", "desc"] as const)) },
    });
    expect(Object.isFrozen(product)).toBe(true);
    const definition = defineWebApp({
        pages: routePages(
            [
                {
                    id: "product",
                    handler: (params, _context, query) => ({
                        id: String(params.id),
                        pageType: "product",
                        title: String(query.sort),
                    }),
                },
            ],
            [product],
        ),
        id: "typed-route",
        getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
    });
    const framework = createWebRuntime({ definition });
    try {
        const match = await framework.router.resolve("/product/42?sort=desc");
        expect(match?.intent.params).toEqual({ id: 42 });
        expect(match?.intent.query).toEqual({ sort: "desc" });
        expect(await loadPage({ web: framework, target: "/product/42?sort=desc" })).toMatchObject({
            kind: "page",
            page: { id: "42", title: "desc" },
        });
        expect(await framework.router.resolve("/product/invalid")).toBeNull();
        expect(await framework.router.resolve("/product/42?sort=invalid")).toBeNull();
    } finally {
        await framework.dispose();
    }
});
