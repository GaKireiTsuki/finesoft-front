import { describe, expect, test, vi } from "vite-plus/test";
import { defineRoutes, route } from "../../src/bootstrap/define-routes";
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
