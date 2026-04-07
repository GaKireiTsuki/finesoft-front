import { describe, expect, test, vi } from "vite-plus/test";
import { defineRoutes } from "../../src/bootstrap/define-routes";

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
        });
        expect(add).toHaveBeenNthCalledWith(2, "/:locale", "home", {
            renderMode: undefined,
            beforeGuards: beforeLoad,
            afterGuards: afterLoad,
        });
        expect(add).toHaveBeenNthCalledWith(3, "/about", "home", {
            renderMode: undefined,
            beforeGuards: undefined,
            afterGuards: undefined,
        });
        expect(add).toHaveBeenNthCalledWith(4, "/:locale/about", "home", {
            renderMode: undefined,
            beforeGuards: undefined,
            afterGuards: undefined,
        });
    });
});
