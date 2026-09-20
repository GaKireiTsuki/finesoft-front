vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
import { expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import { defineWebApp, markPublic } from "@finesoft/web";
import { routePages } from "../../web/test/helpers/definition";
import { createSSRRender } from "../src/create-render";
import { serializeServerData } from "../src/server-data";

test("native page data retains declared nested actions while excluding internal fields", async () => {
    const page = markPublic(
        {
            id: "home",
            pageType: "home",
            title: "Home",
            shelves: [
                {
                    name: "Featured",
                    items: [{ name: "TypeScript Handbook", clickAction: { url: "/products/1" } }],
                    seeAllAction: { url: "/search" },
                },
            ],
            internalSecret: "TEMPLATE_SECRET",
        },
        {
            shelves: {
                name: true,
                items: { name: true, clickAction: { url: true } },
                seeAllAction: { url: true },
            },
        },
    );
    const definition = defineWebApp({
        id: "public-page",
        pages: routePages([{ id: "home", handler: () => page }], [{ path: "/", intentId: "home" }]),
        getErrorPage: (status, message) => ({
            id: String(status),
            pageType: "error",
            title: message,
        }),
    });
    const render = createSSRRender({ definition, render: () => "Home" });
    const result = await render("/");
    const data = JSON.parse(serializeServerData(result.serverData)).payload.pages[0].data;
    expect(data.internalSecret).toBeUndefined();
    expect(data.shelves[0].items[0].name).toBe("TypeScript Handbook");
    expect(data.shelves[0].items[0].clickAction.url).toBe("/products/1");
    expect(data.shelves[0].seeAllAction.url).toBe("/search");
    await render.dispose();
});
