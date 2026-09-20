import { describe, expect, test } from "vite-plus/test";
import { fixtureDefinition } from "../../web/test/helpers/definition";
import { createSSRRender } from "../src/create-render";

describe("createSSRRender", () => {
    test("passes one composed WebAppView to the native renderer", async () => {
        const render = createSSRRender({
            definition: fixtureDefinition([
                {
                    path: "/home",
                    intentId: "home",
                    controller: {
                        intentId: "home",
                        perform() {
                            return { id: "home", pageType: "home", title: "Home" };
                        },
                    },
                },
            ]),
            render: (app) => {
                const snapshot = app.getSnapshot();
                expect(snapshot.entries).toHaveLength(1);
                expect(snapshot.destinations[0]?.page.title).toBe("Home");
                expect(app.locale).toBeUndefined();
                return { html: `<main>${snapshot.entries[0]!.page.title}</main>` };
            },
        });

        await expect(render("/home")).resolves.toMatchObject({
            html: "<main>Home</main>",
            head: "",
            css: "",
            serverData: {
                pages: [
                    {
                        entryId: expect.any(String),
                        intent: { id: "home", params: {} },
                        data: { id: "home", pageType: "home", title: "Home" },
                    },
                ],
            },
        });
        expect(render.routes).toEqual([
            expect.objectContaining({ path: "/home", intentId: "home" }),
        ]);
        await render.dispose();
    });

    test("applies configuration and locale resolution to the request view", async () => {
        const definition = fixtureDefinition([
            {
                path: "/",
                intentId: "home",
                controller: {
                    intentId: "home",
                    perform() {
                        return { id: "home", pageType: "home", title: "Home" };
                    },
                },
            },
        ]);
        const render = createSSRRender({
            definition,
            configuration: { locale: "en-US" },
            resolveLocale: () => ({ lang: "zh-Hans", dir: "ltr" }),
            render: (app) => {
                expect(app.locale).toEqual({ lang: "zh-Hans", dir: "ltr" });
                return {
                    html: "ok",
                    head: '<meta name="language" content="zh-Hans">',
                    css: ".app{}",
                };
            },
        });

        await expect(
            render("/", { request: new Request("https://example.com/") }),
        ).resolves.toMatchObject({
            html: "ok",
            head: '<meta name="language" content="zh-Hans">',
            css: ".app{}",
            locale: { lang: "zh-Hans", dir: "ltr" },
        });
        await render.dispose();
    });
});
