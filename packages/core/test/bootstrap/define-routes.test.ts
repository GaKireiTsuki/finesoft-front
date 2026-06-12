import { describe, expect, test, vi } from "vite-plus/test";
import { defineRoute, defineRoutes, route } from "../../src/bootstrap/define-routes";
import type { Container } from "../../src/dependencies/container";
import { Framework } from "../../src/framework";
import { BaseController } from "../../src/intents/base-controller";
import { int } from "../../src/router/params";

class ProductController extends BaseController<{ id: number }, { id: number }> {
    readonly intentId = "product";
    execute(params: { id: number }, _c: Container) {
        return { id: params.id };
    }
}

describe("defineRoutes", () => {
    test("registers controllers once and adds locale-aware routes", () => {
        const registerIntent = vi.fn();
        const add = vi.fn();
        const controller = {
            intentId: "home",
            perform: vi.fn(),
        };
        const beforeLoad = [vi.fn()];
        const afterLoad = [vi.fn()];
        const framework = {
            registerIntent,
            router: {
                add,
            },
        };

        defineRoutes(
            framework as never,
            [
                {
                    path: "/",
                    intentId: "home",
                    controller,
                    beforeLoad,
                    afterLoad,
                },
                {
                    path: "/about",
                    intentId: "home",
                },
            ],
            { locales: ["zh", "en"] },
        );

        expect(registerIntent).toHaveBeenCalledTimes(1);
        expect(registerIntent).toHaveBeenCalledWith(controller);
        expect(add).toHaveBeenNthCalledWith(1, "/", "home", {
            renderMode: undefined,
            beforeGuards: beforeLoad,
            afterGuards: afterLoad,
            paramCodecs: undefined,
            queryCodecs: undefined,
        });
        expect(add).toHaveBeenNthCalledWith(2, "/:locale", "home", {
            renderMode: undefined,
            beforeGuards: beforeLoad,
            afterGuards: afterLoad,
            paramCodecs: undefined,
            queryCodecs: undefined,
        });
        expect(add).toHaveBeenNthCalledWith(3, "/about", "home", {
            renderMode: undefined,
            beforeGuards: undefined,
            afterGuards: undefined,
            paramCodecs: undefined,
            queryCodecs: undefined,
        });
        expect(add).toHaveBeenNthCalledWith(4, "/:locale/about", "home", {
            renderMode: undefined,
            beforeGuards: undefined,
            afterGuards: undefined,
            paramCodecs: undefined,
            queryCodecs: undefined,
        });
    });
});

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

describe("defineRoute (functional handler with auto-typed params)", () => {
    test("synthesizes a controller; handler receives converted params", async () => {
        const def = defineRoute("/product/:id", {
            intentId: "product",
            params: { id: int() },
            handler: (params) => ({ doubled: params.id * 2 }),
        });

        const result = await def.controller?.perform(
            { id: "product", params: { id: 21 } },
            {} as Container,
        );
        expect(result).toEqual({ doubled: 42 });
    });

    test("falls back on handler error when fallback provided", async () => {
        const def = defineRoute("/x", {
            intentId: "x",
            handler: () => {
                throw new Error("boom");
            },
            fallback: (_params, error) => ({ error: error.message }),
        });

        const result = await def.controller?.perform({ id: "x", params: {} }, {} as Container);
        expect(result).toEqual({ error: "boom" });
    });

    test("re-throws handler error when no fallback provided", async () => {
        const def = defineRoute("/x", {
            intentId: "x",
            handler: () => {
                throw new Error("boom");
            },
        });

        await expect(
            def.controller?.perform({ id: "x", params: {} }, {} as Container),
        ).rejects.toThrow("boom");
    });

    test("integrates through defineRoutes + routeUrl", async () => {
        const fw = Framework.create({});
        defineRoutes(fw, [
            defineRoute("/product/:id", {
                intentId: "product",
                params: { id: int() },
                handler: (params) => ({ id: params.id }),
            }),
        ]);

        const match = await fw.routeUrl("/product/7");
        expect(match?.intent.params).toEqual({ id: 7 });
    });
});
