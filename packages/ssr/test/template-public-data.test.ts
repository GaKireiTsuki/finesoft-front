import { expect, test, vi } from "vite-plus/test";
vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));
vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
vi.mock("@finesoft/front", async () => ({
    ...(await import("../../core/src/index.ts")),
    ...(await import("../../web/src/index.ts")),
}));
import { serializeServerData } from "../src/server-data";
import { HomeController as ReactHome } from "../../../templates/react/src/lib/controllers/home";
import { HomeController as VueHome } from "../../../templates/vue/src/lib/controllers/home";
import { HomeController as SvelteHome } from "../../../templates/svelte/src/lib/controllers/home";
import { HomeController as ReactFeed } from "../../../templates/react-minimal/src/lib/controllers/home";
import { HomeController as VueFeed } from "../../../templates/vue-minimal/src/lib/controllers/home";

test("full templates retain explicit nested shelves/actions and minimal templates retain feed items", () => {
    for (const Controller of [ReactHome, VueHome, SvelteHome, ReactFeed, VueFeed]) {
        const page = Object.assign(new Controller().execute(), {
            internalSecret: "TEMPLATE_SECRET",
        });
        const data = JSON.parse(
            serializeServerData([{ entryId: "home", intent: { id: "home" }, data: page }]),
        ).payload[0].data;
        expect(data.internalSecret).toBeUndefined();
        if ("shelves" in page) {
            expect(data.shelves[0].items[0].name).toBe("TypeScript Handbook");
            expect(data.shelves[0].items[0].clickAction.url).toBe("/products/1");
            expect(data.shelves[0].seeAllAction.url).toBe("/search");
        } else {
            expect(data.items[0]).toEqual({ id: "1", title: "Structured navigation" });
        }
    }
});
