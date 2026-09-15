import { expect, test, vi } from "vite-plus/test";
vi.mock("@finesoft/web", async () => import("../../web/src/index"));
vi.mock("@finesoft/core", async () => import("../../core/src/index"));
import { defineWebApp } from "@finesoft/web";
import { createSSRRender } from "../src/create-render";
import { serializeServerData } from "../src/index";

test("standard reusable Web SSR retains Runtime while request fetch and cleanup remain scoped", async () => {
    const runtimes: string[] = [];
    const cleaned: string[] = [];
    const requests = Object.fromEntries(
        ["a", "b", "c"].map((name) => [name, new Request(`https://example.com/${name}`)]),
    );
    const web = defineWebApp({
        id: "ssr-web",
        controllers: [
            {
                id: "home",
                handler: async (_params, ctx) => {
                    runtimes.push(ctx.runtimeId);
                    expect(ctx.bindings.request).toBe(requests[String(ctx.bindings.name)]);
                    ctx.onDispose(() => {
                        cleaned.push(String(ctx.bindings.name));
                    });
                    const response = await ctx.fetch("/data");
                    return {
                        id: String(ctx.bindings.name),
                        pageType: "home",
                        title: await response.text(),
                    };
                },
            },
        ],
        routes: [{ path: "/", intentId: "home" }],
        getErrorPage: (status, message) => ({
            id: String(status),
            pageType: "error",
            title: message,
        }),
    });
    const render = createSSRRender({
        definition: web,
        renderApp: async (page) => {
            expect(cleaned).not.toContain(page.id);
            return { html: page.title!, head: "", css: "" };
        },
    });
    const a = render("/", {
        request: requests.a,
        bindings: { name: "a" },
        fetch: async () => new Response("a"),
    });
    const b = render("/", {
        request: requests.b,
        bindings: { name: "b" },
        fetch: async () => new Response("b"),
    });
    const [first, second] = await Promise.all([a, b]);
    expect(first).toMatchObject({ html: "a" });
    expect(first.cache).toBeUndefined();
    expect(second.html).toBe("b");
    expect(new Set(runtimes).size).toBe(1);
    expect(cleaned.sort()).toEqual(["a", "b"]);
    expect(
        (
            await render("/", {
                request: requests.c,
                bindings: { name: "c" },
                fetch: async () => new Response("c"),
            })
        ).html,
    ).toBe("c");
    await render.dispose();
});

test("ordinary SSR hydration preserves the generated page EntryId and one-shot data", async () => {
    const { Framework, PrefetchedIntents, loadPage } = await import("@finesoft/web");
    let calls = 0;
    const definition = defineWebApp({
        id: "hydrate",
        controllers: [
            {
                id: "home",
                handler: () => ({ id: String(++calls), pageType: "home", title: "Home" }),
            },
        ],
        routes: [{ path: "/", intentId: "home" }],
        getErrorPage: (status, message) => ({
            id: String(status),
            pageType: "error",
            title: message,
        }),
    });
    const render = createSSRRender({
        definition,
        renderApp: () => ({ html: "home", head: "", css: "" }),
    });
    const output = await render("/");
    expect(output.serverData[0].entryId).toEqual(expect.any(String));
    const browser = Framework.create({
        definition,
        prefetchedIntents: PrefetchedIntents.fromArray(output.serverData),
    });
    const loaded = await loadPage({ framework: browser, target: "/" });
    expect(loaded).toMatchObject({
        kind: "page",
        target: { entryId: output.serverData[0].entryId },
    });
    expect(calls).toBe(1);
    await browser.dispose();
    await render.dispose();
});

test("standard SSR producer exposes public prerender only by explicit route declaration", async () => {
    const { createSSRHandler } = await import("../../server/src/ssr-handler");
    const definition = defineWebApp({
        id: "public-web",
        controllers: [
            { id: "home", handler: () => ({ id: "home", pageType: "home", title: "Public" }) },
        ],
        routes: [
            { path: "/public", intentId: "home", renderMode: "prerender", cache: "public" },
            { path: "/private", intentId: "home", renderMode: "prerender" },
        ],
        getErrorPage: (status, message) => ({
            id: String(status),
            pageType: "error",
            title: message,
        }),
    });
    const render = createSSRRender({
        definition,
        renderApp: () => ({ html: "<main>public-page</main>", head: "", css: "" }),
    });
    expect((await render("/public")).cache).toBe("public");
    expect((await render("/private")).cache).toBeUndefined();
    const handler = createSSRHandler({
        render,
        serializeServerData,
        template:
            "<html><head><!--ssr-head--></head><body><!--ssr-body--><!--ssr-data--></body></html>",
    });
    const response = await handler(new Request("https://example.com/public"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<main>public-page</main>");
    await render.dispose();
});

test("definition framework defaults reach per-request message loading and controller scope", async () => {
    const definition = defineWebApp({
        id: "locale-default",
        frameworkConfig: { locale: "en-US" },
        routes: [{ path: "/", intentId: "home" }],
        controllers: [
            {
                id: "home",
                handler: (_params, ctx) => ({
                    id: "home",
                    pageType: "home",
                    title: String(ctx.locale),
                }),
            },
        ],
        getErrorPage: (status, message) => ({
            id: String(status),
            pageType: "error",
            title: message,
        }),
    });
    const render = createSSRRender({
        definition,
        loadMessages: async () => ({ hello: "Hello" }),
        renderApp: (page, fw) => ({
            html: `${page.title}:${fw.getTranslator()?.t("hello")}`,
            head: "",
            css: "",
        }),
    });
    expect((await render("/")).html).toBe("en-US:Hello");
    await render.dispose();
});

test("SSR and browser tree producers preserve the shared seven-stage guard order", async () => {
    const { Framework, createNavigationController, createActiveLeafCodec, leaf, next } =
        await import("@finesoft/web");
    const { createSSRNavigationRender } = await import("../src/navigation");
    const calls: string[] = [];
    const guard = (name: string) => () => {
        calls.push(name);
        return next();
    };
    const definition = defineWebApp({
        id: "guard-producers",
        controllers: [
            {
                id: "home",
                handler: () => {
                    calls.push("controller");
                    return { id: "home", pageType: "home", title: "Home" };
                },
            },
        ],
        routes: [
            {
                path: "/",
                intentId: "home",
                beforeLoad: [guard("route-before")],
                afterLoad: [guard("route-after")],
            },
        ],
        beforeLoad: [guard("global-before")],
        afterLoad: [guard("global-after")],
        getErrorPage: (status, message) => ({
            id: String(status),
            pageType: "error",
            title: message,
        }),
    });
    const beforeLoad = [guard("navigation-before")],
        afterLoad = [guard("navigation-after")];
    const expected = [
        "global-before",
        "route-before",
        "navigation-before",
        "controller",
        "global-after",
        "route-after",
        "navigation-after",
    ];
    const render = createSSRNavigationRender({
        definition,
        navigation: { codec: createActiveLeafCodec(), beforeLoad, afterLoad },
        renderApp: () => ({ html: "home", head: "", css: "" }),
    });
    await render("/");
    expect(calls).toEqual(expected);
    calls.length = 0;
    const framework = Framework.create({ definition });
    const browser = createNavigationController({
        framework,
        isServer: false,
        initial: leaf("home"),
        beforeLoad,
        afterLoad,
    });
    await browser.resolve();
    expect(calls).toEqual(expected);
    await browser.dispose();
    await framework.dispose();
    await render.dispose();
});
