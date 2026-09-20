import { describe, expect, test } from "vite-plus/test";
import { fixtureDefinition } from "../../web/test/helpers/definition";
import { createSSRRender } from "../src/create-render";
import { DEP_KEYS, defineApp, provide, SimpleTranslator, type Translator } from "@finesoft/core";
import { definePage, defineWebApp } from "@finesoft/web";
import { int, str, list } from "@finesoft/core";

test("SSR serializes path and query independently for hydration", async () => {
    const page = definePage({
        id: "item",
        routes: [
            { path: "/item/:id", params: { id: int() }, query: { id: str(), tags: list(str()) } },
        ],
        handler: (params, _context, query) => ({
            id: String(params.id),
            pageType: "item",
            title: query.id,
        }),
    });
    const render = createSSRRender({
        definition: defineWebApp({
            id: "query-ssr",
            pages: [page],
            getErrorPage: (_, title) => ({ id: "error", pageType: "error", title }),
        }),
        render: (app) => app.getSnapshot().destinations[0].page.title,
    });
    try {
        expect(await render("/item/42?id=search&tags=a&tags=b")).toMatchObject({
            html: "search",
            serverData: {
                pages: [
                    {
                        intent: {
                            id: "item",
                            params: { id: 42 },
                            query: { id: "search", tags: ["a", "b"] },
                        },
                    },
                ],
            },
        });
    } finally {
        await render.dispose();
    }
});

test.each([false, true])(
    "renderer shutdown drains pending message loading (failure=%s)",
    async (fail) => {
        let release!: () => void, begin!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const begun = new Promise<void>((resolve) => {
            begin = resolve;
        });
        const failure = new Error("loader failure");
        const render = createSSRRender({
            definition: defineWebApp({
                id: "closing-render",
                configuration: { locale: "en" },
                loadMessages: async () => {
                    begin();
                    await gate;
                    if (fail) throw failure;
                    return {};
                },
                pages: [
                    {
                        id: "home",
                        routes: ["/"],
                        handler: () => ({ id: "home", pageType: "home", title: "Home" }),
                    },
                ],
                getErrorPage: (_, title) => ({ id: "error", pageType: "error", title }),
            }),
            render: () => "ready",
        });
        const work = render("/");
        await begun;
        let disposed = false;
        const closing = render.dispose().then(() => {
            disposed = true;
        });
        await expect(render("/")).rejects.toThrow("disposed");
        expect(disposed).toBe(false);
        release();
        if (fail) await expect(work).rejects.toBe(failure);
        else expect((await work).html).toBe("ready");
        await closing;
        expect(disposed).toBe(true);
    },
);

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
            render: async (app) => {
                const snapshot = app.getSnapshot();
                expect(snapshot.entries).toHaveLength(1);
                expect(snapshot.destinations[0]?.page.title).toBe("Home");
                expect(app.locale).toBeUndefined();
                await expect(app.perform({ kind: "flow", url: "/home" })).rejects.toMatchObject({
                    code: "configuration",
                });
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
            resolveLocale: () => ({ lang: "zh-Hans", dir: "rtl" }),
            render: (app) => {
                expect(app.locale).toEqual({ lang: "zh-Hans", dir: "rtl" });
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
            locale: { lang: "zh-Hans", dir: "rtl" },
        });
        await render.dispose();
    });
});

test("concurrent SSR views share their request providers and dispose them after rendering", async () => {
    const translators = new Map<string, Translator>();
    const disposed: string[] = [];
    const render = createSSRRender({
        definition: defineWebApp({
            id: "request-services",
            configuration: { locale: "en" },
            app: defineApp({
                id: "request-services",
                providers: [
                    provide({
                        token: DEP_KEYS.LOCALE,
                        lifetime: "scope",
                        create: async (context) => ({
                            lang: String(context.bindings.language),
                            dir: "rtl",
                        }),
                    }),
                    provide({
                        token: DEP_KEYS.TRANSLATOR,
                        lifetime: "scope",
                        dependencies: [DEP_KEYS.LOCALE],
                        create: async (context) => {
                            const locale = await context.get(DEP_KEYS.LOCALE);
                            const translator = new SimpleTranslator({
                                locale: locale.lang,
                                messages: { title: locale.lang },
                            });
                            translators.set(locale.lang, translator);
                            return translator;
                        },
                        dispose: (translator) => {
                            disposed.push(translator.locale);
                        },
                    }),
                ],
            }),
            pages: [
                {
                    id: "home",
                    routes: ["/"],
                    handler: async (_input, context) => {
                        const translator = await context.get(DEP_KEYS.TRANSLATOR);
                        expect(translator).toBe(translators.get(translator.locale));
                        return { id: "home", pageType: "home", title: translator.t("title") };
                    },
                },
            ],
            getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
        }),
        render: async (app) => {
            const language = app.locale!.lang;
            expect(app.locale!.dir).toBe("rtl");
            expect(app.translator).toBe(translators.get(language));
            expect(disposed).not.toContain(language);
            expect(app.getSnapshot().entries[0].page.title).toBe(language);
            return app.translator!.t("title");
        },
    });
    try {
        const results = await Promise.all(
            ["fr", "de"].map((language) => render("/", { bindings: { language } })),
        );
        expect(results.map((result) => [result.html, result.locale])).toEqual([
            ["fr", { lang: "fr", dir: "rtl" }],
            ["de", { lang: "de", dir: "rtl" }],
        ]);
        expect(disposed.sort()).toEqual(["de", "fr"]);
    } finally {
        await render.dispose();
    }
    expect(disposed).toHaveLength(2);
});
