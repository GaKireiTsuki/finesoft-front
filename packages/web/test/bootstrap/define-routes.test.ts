import { expect, test } from "vite-plus/test";
import { int, oneOf, optional } from "@finesoft/core";
import { route } from "../../src/bootstrap/define-routes";
import { defineWebApp } from "../../src/application/definition";
import { Framework } from "../../src/framework";
test("immutable route declarations decode path and query through the definition owner", async () => {
    const product = route("/product/:id", {
        intentId: "product",
        params: { id: int() },
        query: { sort: optional(oneOf(["asc", "desc"] as const)) },
    });
    expect(Object.isFrozen(product)).toBe(true);
    const definition = defineWebApp({
        id: "typed-route",
        routes: [product],
        controllers: [
            {
                id: "product",
                handler: (params) => ({
                    id: String(params.id),
                    pageType: "product",
                    title: String(params.sort),
                }),
            },
        ],
        getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
    });
    const framework = Framework.create({ definition });
    try {
        const match = await framework.routeUrl("/product/42?sort=desc");
        expect(match?.intent.params).toEqual({ id: 42, sort: "desc" });
        expect(await framework.dispatch(match!.intent)).toMatchObject({ id: "42", title: "desc" });
        expect(await framework.routeUrl("/product/invalid")).toBeNull();
        expect(await framework.routeUrl("/product/42?sort=invalid")).toBeNull();
    } finally {
        await framework.dispose();
    }
});
