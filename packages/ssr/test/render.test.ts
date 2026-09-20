import { DEP_KEYS, HostGuardError, str } from "../../core/src/index";
import { expect, test, vi } from "vite-plus/test";
import { defineWebApp, leaf, markPublic, split } from "@finesoft/web";
import { routePages } from "../../web/test/helpers/definition";
import { createSSRRender } from "../src/create-render";

function errorPage(status: number, message: string) {
    return { id: `error-${status}`, pageType: "error", title: message };
}

function titleRenderer(app: {
    getSnapshot(): { entries: readonly { page: { title?: string } }[] };
}) {
    return app.getSnapshot().entries.at(-1)?.page.title ?? "";
}

function singlePageDefinition(
    path: string,
    id = "home",
    handler: (params: Record<string, unknown>, context: any) => any = () => ({
        id,
        pageType: "home",
        title: "Home",
    }),
    route: Record<string, unknown> = {},
) {
    return defineWebApp({
        id: `ssr-${id}`,
        pages: routePages([{ id, handler }], [{ path, intentId: id, ...route } as any]),
        getErrorPage: errorPage,
    });
}

test("SSR installs the host resolver in the request's protected fetch", async () => {
    const fetch = vi.fn(async () => new Response("ok"));
    const lookup = vi.fn(async () => ["127.0.0.1"]);
    let safeFetch: typeof globalThis.fetch | undefined;
    const definition = singlePageDefinition("/", "home", async (_params, context) => {
        safeFetch = await context.get(DEP_KEYS.SAFE_FETCH);
        return { id: "home", pageType: "home", title: "ok" };
    });
    const render = createSSRRender({
        definition,
        configuration: { safeFetch: { lookup } },
        render: (app) => ({ html: titleRenderer(app) }),
    });
    await render("/", { fetch });
    await expect(safeFetch!("https://example.com")).rejects.toBeInstanceOf(HostGuardError);
    expect(lookup).toHaveBeenCalledWith("example.com");
    expect(fetch).not.toHaveBeenCalled();
    await render.dispose();
});

test("SSR default storage is shared within one request and fresh for the next request", async () => {
    const definition = defineWebApp({
        id: "request-storage",
        navigation: split([
            { id: "writer", content: leaf("writer") },
            { id: "reader", content: leaf("reader") },
        ]),
        pages: routePages(
            [
                {
                    id: "writer",
                    handler: async (_params, context) => {
                        const storage = await context.get(DEP_KEYS.STORAGE);
                        const previous = storage.get("request") ?? "fresh";
                        storage.set("request", `${previous}:writer`);
                        return { id: "writer", pageType: "writer", title: previous };
                    },
                },
                {
                    id: "reader",
                    handler: async (_params, context) => ({
                        id: "reader",
                        pageType: "reader",
                        title: (await context.get(DEP_KEYS.STORAGE)).get("request") ?? "missing",
                    }),
                },
            ],
            [
                { path: "/writer", intentId: "writer" },
                { path: "/reader", intentId: "reader" },
            ],
        ),
        getErrorPage: errorPage,
    });
    const render = createSSRRender({
        definition,
        render: (app) =>
            app
                .getSnapshot()
                .entries.map((entry) => entry.page.title)
                .join(","),
    });

    await expect(render("/writer")).resolves.toMatchObject({ html: "fresh,fresh:writer" });
    await expect(render("/writer")).resolves.toMatchObject({ html: "fresh,fresh:writer" });
    await render.dispose();
});

test("loads async messages before native rendering and exposes the translator", async () => {
    const loadMessages = vi.fn(async () => ({ hello: "Hello" }));
    const definition = defineWebApp({
        id: "messages",
        configuration: { locale: "en-US" },
        loadMessages,
        pages: routePages(
            [{ id: "home", handler: () => ({ id: "home", pageType: "home", title: "Home" }) }],
            [{ path: "/", intentId: "home" }],
        ),
        getErrorPage: errorPage,
    });
    const render = createSSRRender({
        definition,
        render: (app) => ({ html: app.translator?.t("hello") ?? "missing" }),
    });
    const request = new Request("https://example.com/?from=test");
    const output = await render("/?from=test", { request, fetch: globalThis.fetch });
    expect(loadMessages).toHaveBeenCalledWith(
        "en-US",
        expect.objectContaining({ runtime: "server", url: "/?from=test", request }),
    );
    expect(output.html).toBe("Hello");
    expect(output.locale).toEqual({ lang: "en-US", dir: "ltr" });
    await render.dispose();
});

test("uses resolveLocale output when calling the definition message loader", async () => {
    const internalFetch = vi.fn(async () => new Response("{}"));
    const loadMessages = vi.fn(async (locale: string) => ({
        hello: locale === "zh-Hans" ? "你好" : "wrong",
    }));
    const definition = defineWebApp({
        id: "localized",
        configuration: { locale: "en-US" },
        loadMessages,
        pages: routePages(
            [{ id: "home", handler: () => ({ id: "home", pageType: "home", title: "Home" }) }],
            [{ path: "/zh-Hans", intentId: "home" }],
        ),
        getErrorPage: errorPage,
    });
    const request = new Request("https://example.com/zh-Hans");
    const render = createSSRRender({
        definition,
        resolveLocale: () => ({ lang: "zh-Hans", dir: "ltr" }),
        render: (app) => ({ html: app.translator?.t("hello") ?? "missing" }),
    });
    await expect(render("/zh-Hans", { request, fetch: internalFetch })).resolves.toMatchObject({
        html: "你好",
        locale: { lang: "zh-Hans", dir: "ltr" },
    });
    expect(loadMessages).toHaveBeenCalledWith(
        "zh-Hans",
        expect.objectContaining({ fetch: internalFetch, request }),
    );
    await render.dispose();
});

test("does not create a translator when no dictionary is configured", async () => {
    const definition = defineWebApp({
        id: "no-messages",
        configuration: { locale: "en-US" },
        pages: routePages(
            [{ id: "home", handler: () => ({ id: "home", pageType: "home", title: "Home" }) }],
            [{ path: "/", intentId: "home" }],
        ),
        getErrorPage: errorPage,
    });
    const render = createSSRRender({
        definition,
        render: (app) => ({ html: app.translator?.t("hello") ?? "missing" }),
    });
    await expect(render("/")).resolves.toMatchObject({ html: "missing" });
    await render.dispose();
});

test("propagates definition message-loader failures", async () => {
    const definition = defineWebApp({
        id: "message-failure",
        configuration: { locale: "en-US" },
        loadMessages: async () => {
            throw Error("failed to load messages");
        },
        pages: [],
        getErrorPage: errorPage,
    });
    const render = createSSRRender({ definition, render: () => "" });
    await expect(render("/")).rejects.toThrow("failed to load messages");
    await render.dispose();
});

test("returns an empty shell for CSR routes without invoking the native renderer", async () => {
    const native = vi.fn(() => "unexpected");
    const definition = singlePageDefinition("/", "home", undefined, { renderMode: "csr" });
    const render = createSSRRender({ definition, render: native });
    await expect(render("/")).resolves.toMatchObject({
        html: "",
        head: "",
        css: "",
        serverData: { pages: [] },
        renderMode: "csr",
    });
    expect(native).not.toHaveBeenCalled();
    await render.dispose();
});

test("short-circuits with a redirect when a route guard blocks the request", async () => {
    const native = vi.fn(() => "unexpected");
    const definition = singlePageDefinition("/private", "private", undefined, {
        beforeLoad: [() => ({ kind: "redirect", url: "/login", status: 302 })],
    });
    const render = createSSRRender({ definition, render: native });
    await expect(render("/private")).resolves.toMatchObject({
        html: "",
        head: "",
        css: "",
        serverData: { pages: [] },
        redirect: { url: "/login", status: 302 },
    });
    expect(native).not.toHaveBeenCalled();
    await render.dispose();
});

test("renders a safe error page when a route guard denies access", async () => {
    const native = vi.fn(
        (app: { getSnapshot(): { entries: readonly { page: { title?: string } }[] } }) => ({
            html: titleRenderer(app),
            head: '<meta name="robots" content="noindex">',
            css: ".error{}",
        }),
    );
    const definition = singlePageDefinition("/private", "private", undefined, {
        beforeLoad: [() => ({ kind: "deny", status: 403, message: "Forbidden zone" })],
    });
    const render = createSSRRender({ definition, render: native });
    await expect(render("/private")).resolves.toMatchObject({
        html: "Forbidden zone",
        status: 403,
        serverData: { pages: [] },
    });
    expect(native).toHaveBeenCalledTimes(1);
    await render.dispose();
});

test("afterLoad rewrite renders loaded data and exposes rewriteUrl", async () => {
    const definition = singlePageDefinition(
        "/products",
        "product",
        () => ({
            id: "product-1",
            pageType: "product",
            title: "product-1",
        }),
        { afterLoad: [() => ({ kind: "rewrite", url: "/products/1" })] },
    );
    const render = createSSRRender({ definition, render: (app) => titleRenderer(app) });
    await expect(render("/products?id=1")).resolves.toMatchObject({
        html: "product-1",
        rewriteUrl: "/products/1",
    });
    await render.dispose();
});

test("beforeLoad rewrite internally re-routes to the new URL", async () => {
    const legacy = vi.fn(() => ({ id: "legacy", pageType: "legacy", title: "legacy" }));
    const canonical = vi.fn(() => ({ id: "canonical", pageType: "canonical", title: "canonical" }));
    const definition = defineWebApp({
        id: "rewrite",
        pages: routePages(
            [
                { id: "legacy", handler: legacy },
                { id: "canonical", handler: canonical },
            ],
            [
                {
                    path: "/legacy",
                    intentId: "legacy",
                    beforeLoad: [() => ({ kind: "rewrite", url: "/canonical" })],
                },
                { path: "/canonical", intentId: "canonical", renderMode: "csr" },
            ],
        ),
        getErrorPage: errorPage,
    });
    const render = createSSRRender({ definition, render: (app) => titleRenderer(app) });
    await expect(render("/legacy")).resolves.toMatchObject({
        html: "canonical",
        renderMode: "csr",
    });
    expect(legacy).not.toHaveBeenCalled();
    expect(canonical).toHaveBeenCalledTimes(1);
    await render.dispose();
});

test("aborts on rewrite recursion to prevent infinite loops", async () => {
    const definition = defineWebApp({
        id: "rewrite-loop",
        pages: routePages(
            [
                { id: "a", handler: () => ({ id: "a", pageType: "a", title: "a" }) },
                { id: "b", handler: () => ({ id: "b", pageType: "b", title: "b" }) },
            ],
            [
                { path: "/a", intentId: "a", beforeLoad: [() => ({ kind: "rewrite", url: "/b" })] },
                { path: "/b", intentId: "b", beforeLoad: [() => ({ kind: "rewrite", url: "/a" })] },
            ],
        ),
        getErrorPage: errorPage,
    });
    const render = createSSRRender({ definition, render: () => "" });
    await expect(render("/a")).rejects.toThrow(/rewrite recursion depth exceeded/i);
    await render.dispose();
});

test("renders a 404 page when no route matches", async () => {
    const definition = defineWebApp({ id: "missing", pages: [], getErrorPage: errorPage });
    const render = createSSRRender({ definition, render: (app) => titleRenderer(app) });
    await expect(render("/missing")).resolves.toMatchObject({
        status: 404,
        html: "Page not found",
        serverData: { pages: [] },
    });
    await render.dispose();
});

test("falls back to a 500 error page when a page handler fails", async () => {
    const definition = singlePageDefinition("/broken", "broken", () => {
        throw Error("boom");
    });
    const render = createSSRRender({ definition, render: (app) => titleRenderer(app) });
    await expect(render("/broken")).resolves.toMatchObject({
        status: 500,
        html: "Execution failed",
        serverData: { pages: [] },
    });
    await render.dispose();
});

test("passes decoded path and query parameters to the typed page handler", async () => {
    const seen: Record<string, unknown>[] = [];
    const definition = defineWebApp({
        id: "params",
        pages: routePages(
            [
                {
                    id: "product",
                    handler: (params) => {
                        seen.push(params);
                        return markPublic(
                            { id: "product", pageType: "product", title: String(params.id) },
                            true,
                        );
                    },
                },
            ],
            [
                {
                    path: "/products/:id",
                    intentId: "product",
                    params: { id: str() },
                    query: { ref: str() },
                },
            ],
        ),
        getErrorPage: errorPage,
    });
    const render = createSSRRender({ definition, render: (app) => titleRenderer(app) });
    await expect(render("/products/42?ref=nav")).resolves.toMatchObject({ html: "42" });
    expect(seen).toEqual([{ id: "42", ref: "nav" }]);
    await render.dispose();
});
