import { routePages } from "../helpers/definition";
import { describe, expect, test } from "vite-plus/test";
import { definePage } from "../../src/application/page";
import { defineWebApp } from "../../src/application/definition";
import { createRuntime } from "@finesoft/core";
import { getWebPlan } from "../../src/application/definition";

describe("typed page references", () => {
    test("emit existing declarations with one operation identity and explicit view identity", async () => {
        const page = definePage({
            id: "load-product",
            handler: (params: { id: string }) => ({
                id: params.id,
                pageType: "product" as const,
                title: params.id,
            }),
        });
        expect(page.route("/product/:id").intentId).toBe("load-product");
        const first = page.leaf({ id: "one" }),
            second = page.leaf({ id: "one" });
        expect(first.intent).toBe("load-product");
        expect(first.entryId).not.toBe(second.entryId);
        expect(page.bindView("product", "view")).toEqual({ product: "view" });
        const app = defineWebApp({
            pages: routePages([page], [page.route("/product/:id")]),
            id: "test",
            getErrorPage: (_, title) => ({ id: "error", pageType: "error", title }),
        });
        const plan = getWebPlan(app),
            runtime = createRuntime({ app: plan.app });
        try {
            expect(
                await runtime.execute(plan.operations.get(page.id)!, { id: "one" }),
            ).toMatchObject({ id: "one", pageType: "product" });
        } finally {
            await runtime.dispose();
        }
        const typeAssertions = () => {
            // @ts-expect-error Required controller parameter must be supplied.
            page.leaf();
            // @ts-expect-error Parameter type is retained.
            page.leaf({ id: 1 });
            // @ts-expect-error Result pageType is independent of controller id.
            page.bindView("load-product", "view");
        };
        void typeAssertions;
    });
});
