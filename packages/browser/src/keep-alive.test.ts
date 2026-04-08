import type { BasePage } from "@finesoft/core";
import { describe, expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import { KeepAliveController } from "./keep-alive";

describe("KeepAliveController", () => {
    test("stores and resolves cacheable pages by canonical key and alias", () => {
        const controller = new KeepAliveController();
        const page = makePage("about");

        controller.markCacheable("/about", page, ["/about?tab=team"]);

        expect(controller.resolve("/about")?.entry.page).toBe(page);
        expect(controller.resolve("/about?tab=team")?.entry.page).toBe(page);
    });

    test("does not resolve uncached pages until they are marked cacheable", () => {
        const controller = new KeepAliveController();
        const page = makePage("search");

        controller.remember("/search?q=phone", page);
        expect(controller.resolve("/search?q=phone")).toBeUndefined();

        controller.markCacheable("/search?q=phone", page);
        expect(controller.resolve("/search?q=phone")?.entry.page).toBe(page);
    });

    test("evicts the least recently used entry and notifies listeners", () => {
        const controller = new KeepAliveController({ maxEntries: 1 });
        const listener = vi.fn();
        controller.onEvent(listener);

        const homePage = makePage("home");
        const aboutPage = makePage("about");

        controller.markCacheable("/", homePage);
        controller.markCacheable("/about", aboutPage);

        expect(controller.resolve("/")).toBeUndefined();
        expect(controller.resolve("/about")?.entry.page).toBe(aboutPage);
        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "evict",
                key: "/",
            }),
        );
    });

    test("evictAll clears every cacheable entry", () => {
        const controller = new KeepAliveController();

        controller.markCacheable("/", makePage("home"));
        controller.markCacheable("/about", makePage("about"));

        controller.evictAll();

        expect(controller.resolve("/")).toBeUndefined();
        expect(controller.resolve("/about")).toBeUndefined();
    });
});

function makePage(pageType: string): BasePage {
    return {
        id: pageType,
        pageType,
        title: pageType,
        url: pageType === "home" ? "/" : `/${pageType}`,
    };
}
