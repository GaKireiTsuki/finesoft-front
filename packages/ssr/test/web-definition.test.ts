import { expect, test, vi } from "vite-plus/test";
vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import { defineWebApp, loadPage, markPublic, next, PrefetchedIntents } from "@finesoft/web";
import { routePages } from "../../web/test/helpers/definition";
import { createSSRRender } from "../src/create-render";
import { materializeServerData, serializeServerData } from "../src/server-data";

const errorPage = (status: number, message: string) => ({
    id: String(status),
    pageType: "error",
    title: message,
});

test("standard reusable Web SSR retains Runtime while request fetch and cleanup remain scoped", async () => {
    const runtimes: string[] = [];
    const cleaned: string[] = [];
    const requests = Object.fromEntries(
        ["a", "b", "c"].map((name) => [name, new Request(`https://example.com/${name}`)]),
    );
    const web = defineWebApp({
        id: "ssr-web",
        pages: routePages(
            [
                {
                    id: "home",
                    handler: async (_params, context) => {
                        const name = String(context.bindings.name);
                        runtimes.push(context.runtimeId);
                        expect(context.bindings.request).toBe(requests[name]);
                        context.onDispose(() => {
                            cleaned.push(name);
                        });
                        const response = await context.fetch("/data");
                        return { id: name, pageType: "home", title: await response.text() };
                    },
                },
            ],
            [{ path: "/", intentId: "home" }],
        ),
        getErrorPage: errorPage,
    });
    const render = createSSRRender({
        definition: web,
        render: (app) => app.getSnapshot().entries.at(-1)?.page.title ?? "",
    });
    const [first, second] = await Promise.all([
        render("/", {
            request: requests.a,
            bindings: { name: "a" },
            fetch: async () => new Response("a"),
        }),
        render("/", {
            request: requests.b,
            bindings: { name: "b" },
            fetch: async () => new Response("b"),
        }),
    ]);
    expect(first.html).toBe("a");
    expect(first.cache).toBeUndefined();
    expect(second.html).toBe("b");
    expect(new Set(runtimes).size).toBe(1);
    expect(cleaned.sort()).toEqual(["a", "b"]);
    await expect(
        render("/", {
            request: requests.c,
            bindings: { name: "c" },
            fetch: async () => new Response("c"),
        }),
    ).resolves.toMatchObject({ html: "c" });
    await render.dispose();
});

test("ordinary SSR hydration preserves the generated page EntryId and consumes one-shot data", async () => {
    let calls = 0;
    const definition = defineWebApp({
        id: "hydrate",
        pages: routePages(
            [
                {
                    id: "home",
                    handler: () => ({ id: String(++calls), pageType: "home", title: "Home" }),
                },
            ],
            [{ path: "/", intentId: "home" }],
        ),
        getErrorPage: errorPage,
    });
    const render = createSSRRender({ definition, render: () => "home" });
    const output = await render("/");
    const entryId = output.serverData.pages[0]!.entryId;
    expect(entryId).toEqual(expect.any(String));
    const browser = (await import("@finesoft/web")).createWebRuntime({
        definition,
        prefetchedIntents: PrefetchedIntents.fromArray(output.serverData.pages),
    });
    const loaded = await loadPage({ web: browser, target: "/" });
    expect(loaded).toMatchObject({ kind: "page", target: { entryId }, page: { id: "1" } });
    expect(calls).toBe(1);
    await browser.dispose();
    await render.dispose();
});

test("SSR cache metadata reflects explicit public route declarations", async () => {
    const definition = defineWebApp({
        id: "public-web",
        pages: routePages(
            [{ id: "home", handler: () => ({ id: "home", pageType: "home", title: "Public" }) }],
            [
                { path: "/public", intentId: "home", renderMode: "prerender", cache: "public" },
                { path: "/private", intentId: "home", renderMode: "prerender" },
            ],
        ),
        getErrorPage: errorPage,
    });
    const render = createSSRRender({
        definition,
        render: () => ({ html: "<main>public-page</main>" }),
    });
    expect((await render("/public")).cache).toBe("public");
    expect((await render("/private")).cache).toBeUndefined();
    await render.dispose();
});

test("definition configuration reaches per-request message loading and page scope", async () => {
    const definition = defineWebApp({
        id: "locale-default",
        configuration: { locale: "en-US" },
        loadMessages: async () => ({ hello: "Hello" }),
        pages: routePages(
            [
                {
                    id: "home",
                    handler: (_params, context) => ({
                        id: "home",
                        pageType: "home",
                        title: String(context.locale),
                    }),
                },
            ],
            [{ path: "/", intentId: "home" }],
        ),
        getErrorPage: errorPage,
    });
    const render = createSSRRender({
        definition,
        render: (app) =>
            `${app.getSnapshot().entries.at(-1)?.page.title}:${app.translator?.t("hello")}`,
    });
    await expect(render("/")).resolves.toMatchObject({ html: "en-US:Hello" });
    await render.dispose();
});

test("SSR and route loading preserve the shared before/after guard order", async () => {
    const calls: string[] = [];
    const guard = (name: string) => () => {
        calls.push(name);
        return next();
    };
    const definition = defineWebApp({
        id: "guard-order",
        pages: routePages(
            [
                {
                    id: "home",
                    handler: () => {
                        calls.push("page");
                        return { id: "home", pageType: "home", title: "Home" };
                    },
                },
            ],
            [
                {
                    path: "/",
                    intentId: "home",
                    beforeLoad: [guard("route-before")],
                    afterLoad: [guard("route-after")],
                },
            ],
        ),
        beforeLoad: [guard("global-before")],
        afterLoad: [guard("global-after")],
        getErrorPage: errorPage,
    });
    const render = createSSRRender({ definition, render: () => "Home" });
    await render("/");
    expect(calls).toEqual(["global-before", "route-before", "page", "global-after", "route-after"]);
    await render.dispose();
});

test("SSR materializes declared getters before request cleanup", async () => {
    let closed = false;
    const order: string[] = [];
    const definition = defineWebApp({
        id: "materialization",
        pages: routePages(
            [
                {
                    id: "home",
                    handler: (_params, context) => {
                        context.onDispose(() => {
                            order.push("dispose");
                            closed = true;
                        });
                        return markPublic(
                            {
                                id: "home",
                                pageType: "home",
                                title: "Home",
                                get profile() {
                                    if (closed) throw Error("request-closed");
                                    order.push("project");
                                    return { name: "Public", secret: "PRIVATE" };
                                },
                            },
                            { profile: { name: true } },
                        );
                    },
                },
            ],
            [{ path: "/", intentId: "home" }],
        ),
        getErrorPage: errorPage,
    });
    const render = createSSRRender({ definition, render: () => "Home" });
    const output = await render("/");
    expect(order).toEqual(["project", "dispose"]);
    const wire = serializeServerData(output.serverData);
    expect(wire).toContain("Public");
    expect(wire).not.toContain("PRIVATE");
    expect(order).toEqual(["project", "dispose"]);
    await render.dispose();
});

test("materialized server data preserves the v2 tree and page projection", () => {
    const data = materializeServerData({
        pages: [
            {
                intent: { id: "home" },
                data: { id: "home", pageType: "home", title: "Home", secret: "hidden" },
            },
        ],
    });
    expect(data).toEqual({
        pages: [{ intent: { id: "home" }, data: { id: "home", pageType: "home", title: "Home" } }],
    });
});
