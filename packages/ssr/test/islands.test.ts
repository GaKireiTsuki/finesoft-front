vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
import { expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import { defineWebApp, leaf, split } from "@finesoft/web";
import { routePages } from "../../web/test/helpers/definition";
import { createSSRRender } from "../src/create-render";

test("composed SSR rendering exposes all visible entries to one native renderer", async () => {
    const definition = defineWebApp({
        id: "native-composition",
        navigation: split([
            { id: "list", content: leaf("list") },
            { id: "detail", content: leaf("detail", { id: "2" }) },
        ]),
        pages: routePages(
            [
                { id: "list", handler: () => ({ id: "list", pageType: "list", title: "List" }) },
                {
                    id: "detail",
                    handler: () => ({ id: "detail", pageType: "detail", title: "Detail" }),
                },
            ],
            [
                { path: "/list", intentId: "list" },
                { path: "/detail/:id", intentId: "detail" },
            ],
        ),
        getErrorPage: (status, message) => ({
            id: String(status),
            pageType: "error",
            title: message,
        }),
    });
    const calls: string[] = [];
    const render = createSSRRender({
        definition,
        render: (app) => {
            const entries = app.getSnapshot().entries.filter((entry) => entry.visible);
            calls.push(...entries.map((entry) => entry.intent));
            return entries
                .map(
                    (entry) =>
                        `<section data-intent="${entry.intent}">${entry.page.title}</section>`,
                )
                .join("");
        },
    });
    await expect(render("/list")).resolves.toMatchObject({
        html: '<section data-intent="list">List</section><section data-intent="detail">Detail</section>',
    });
    expect(calls).toEqual(["list", "detail"]);
    await render.dispose();
});
