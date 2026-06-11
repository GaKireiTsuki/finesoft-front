import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type {
    BasePage,
    IntentController,
    NavigationCodec,
    NavigationNode,
} from "../../core/src/index.ts";
import {
    createActiveLeafCodec,
    createFullStateCodec,
    defineRoutes,
    leaf,
    PrefetchedIntents,
    serializeNavigation,
    split,
    stack,
    tabs,
} from "../../core/src/index.ts";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import { serializeServerData } from "../src/server-data";
import {
    createSSRNavigationRender,
    extractNavigationTree,
    NAVIGATION_TREE_INTENT_ID,
    ssrRenderNavigation,
    stripNavigationTree,
} from "../src/navigation";

// =====================================================================
// helpers
// =====================================================================

function page(id: string, extra: Record<string, unknown> = {}): BasePage {
    return { id, pageType: "test", title: id, ...extra };
}

function makeController(intentId: string, result: BasePage): IntentController<BasePage> {
    return {
        intentId,
        perform() {
            return result;
        },
    };
}

/** Controller that echoes intent id + params into the page so multi-target dispatch is observable. */
function makeEchoController(intentId: string): IntentController<BasePage> {
    return {
        intentId,
        perform(intent) {
            return page(intentId, { params: intent.params ?? {} });
        },
    };
}

function makeErrorPage(status: number, message: string): BasePage {
    return { id: `error-${status}`, pageType: "error", title: message };
}

/** Find the destination entry for an intent id in serverData (excludes the tree sentinel). */
function dataForIntent(
    serverData: { intent: { id: string }; data: unknown }[],
    intentId: string,
): unknown {
    return serverData.find((e) => e.intent.id === intentId)?.data;
}

// =====================================================================
// tests
// =====================================================================

describe("ssrRenderNavigation", () => {
    afterEach(() => {
        globalThis.__FINESOFT_I18N_LOADER__ = undefined;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    test("single LeafNode tree behaves like flat single-page (one destination + tree sentinel)", async () => {
        const home = page("home");
        const result = await ssrRenderNavigation({
            url: "/?from=test",
            frameworkConfig: {},
            navigation: { codec: createActiveLeafCodec() },
            bootstrap(framework) {
                defineRoutes(framework, [
                    { path: "/", intentId: "home", controller: makeController("home", home) },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp(p) {
                return { html: p.title, head: "", css: "" };
            },
        });

        expect(result.html).toBe("home");
        // primary page is the dispatched home page
        expect(result.snapshot.destinations).toHaveLength(1);
        expect(result.snapshot.destinations[0].intent).toBe("home");
        expect(result.snapshot.destinations[0].params).toEqual({ from: "test" });

        // serverData: home destination (matches single-page shape) + the tree sentinel
        expect(result.serverData).toHaveLength(2);
        expect(dataForIntent(result.serverData, "home")).toBe(home);

        // tree round-trips out of the sentinel
        const restored = extractNavigationTree(result.serverData);
        expect(restored).toEqual(leaf("home", { from: "test" }));
        expect(result.snapshot.tree).toEqual(leaf("home", { from: "test" }));
    });

    test("split prefetches ALL visible columns (multi-region)", async () => {
        const result = await ssrRenderNavigation({
            url: "/list",
            frameworkConfig: {},
            navigation: {
                codec: createActiveLeafCodec(),
                // default structural skeleton: two-column split, both filled
                initial: () =>
                    split([
                        { id: "list", content: leaf("list") },
                        { id: "detail", content: leaf("detail", { itemId: "42" }) },
                    ]),
            },
            bootstrap(framework) {
                defineRoutes(framework, [
                    { path: "/list", intentId: "list", controller: makeEchoController("list") },
                    {
                        path: "/detail/:itemId",
                        intentId: "detail",
                        controller: makeEchoController("detail"),
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp(_p, _fw, snapshot) {
                return {
                    html: snapshot.destinations.map((d) => d.intent).join("+"),
                    head: "",
                    css: "",
                };
            },
        });

        // both columns resolved, in column order
        expect(result.snapshot.destinations.map((d) => d.intent)).toEqual(["list", "detail"]);
        expect(result.html).toBe("list+detail");

        // each destination dispatched its own controller; detail got its params
        const detail = dataForIntent(result.serverData, "detail") as BasePage & {
            params: Record<string, unknown>;
        };
        expect(detail.params).toEqual({ itemId: "42" });

        // serverData = 2 destinations + sentinel
        expect(result.serverData).toHaveLength(3);
        const restored = extractNavigationTree(result.serverData);
        expect(restored).toEqual(
            split([
                { id: "list", content: leaf("list") },
                { id: "detail", content: leaf("detail", { itemId: "42" }) },
            ]),
        );
    });

    test("tabs prefetches only the active branch", async () => {
        const inactivePerform = vi.fn(() => page("settings"));
        const result = await ssrRenderNavigation({
            url: "/home",
            frameworkConfig: {},
            navigation: {
                codec: createActiveLeafCodec(),
                initial: () =>
                    tabs({
                        active: "home",
                        branches: {
                            home: stack(leaf("home")),
                            settings: stack(leaf("settings")),
                        },
                    }),
            },
            bootstrap(framework) {
                defineRoutes(framework, [
                    { path: "/home", intentId: "home", controller: makeEchoController("home") },
                    {
                        path: "/settings",
                        intentId: "settings",
                        controller: { intentId: "settings", perform: inactivePerform },
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp(_p, _fw, snapshot) {
                return {
                    html: snapshot.destinations.map((d) => d.intent).join("+"),
                    head: "",
                    css: "",
                };
            },
        });

        expect(result.snapshot.destinations.map((d) => d.intent)).toEqual(["home"]);
        expect(inactivePerform).not.toHaveBeenCalled();
        expect(result.html).toBe("home");
    });

    test("full-state codec deep-links the entire tree from __nav", async () => {
        const codec: NavigationCodec = createFullStateCodec();
        const deepTree: NavigationNode = stack([leaf("home"), leaf("detail", { id: "7" })]);
        const url = codec.encode(deepTree, { getRoutes: () => [] });

        const result = await ssrRenderNavigation({
            url,
            frameworkConfig: {},
            navigation: { codec },
            bootstrap(framework) {
                defineRoutes(framework, [
                    { path: "/home", intentId: "home", controller: makeEchoController("home") },
                    {
                        path: "/detail/:id",
                        intentId: "detail",
                        controller: makeEchoController("detail"),
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp(p) {
                return { html: p.id, head: "", css: "" };
            },
        });

        // tree restored from the URL overlay; stack top (detail) is the primary/visible destination
        expect(result.snapshot.tree).toEqual(deepTree);
        expect(result.snapshot.destinations.map((d) => d.intent)).toEqual(["detail"]);
        expect(result.html).toBe("detail");
        expect(extractNavigationTree(result.serverData)).toEqual(deepTree);
    });

    test("prefetched destinations restore on the browser side via PrefetchedIntents (no refetch)", async () => {
        const result = await ssrRenderNavigation({
            url: "/list",
            frameworkConfig: {},
            navigation: {
                codec: createActiveLeafCodec(),
                initial: () =>
                    split([
                        { id: "list", content: leaf("list") },
                        { id: "detail", content: leaf("detail", { itemId: "9" }) },
                    ]),
            },
            bootstrap(framework) {
                defineRoutes(framework, [
                    { path: "/list", intentId: "list", controller: makeEchoController("list") },
                    {
                        path: "/detail/:itemId",
                        intentId: "detail",
                        controller: makeEchoController("detail"),
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp() {
                return { html: "", head: "", css: "" };
            },
        });

        // simulate the browser hydration path: strip the sentinel, rebuild PrefetchedIntents
        const tree = extractNavigationTree(result.serverData);
        const destinationEntries = stripNavigationTree(result.serverData);
        expect(destinationEntries).toHaveLength(2);
        expect(destinationEntries.every((e) => e.intent.id !== NAVIGATION_TREE_INTENT_ID)).toBe(
            true,
        );

        const cache = PrefetchedIntents.fromArray(destinationEntries);
        // each visible destination is hydrated by (intent id + params) key
        expect(cache.has({ id: "list", params: {} })).toBe(true);
        expect(cache.has({ id: "detail", params: { itemId: "9" } })).toBe(true);
        expect(tree).toEqual(
            split([
                { id: "list", content: leaf("list") },
                { id: "detail", content: leaf("detail", { itemId: "9" }) },
            ]),
        );
    });

    test("serverData (incl. tree sentinel) serializes safely as JSON for the HTML script", () => {
        // build a tree sentinel + a destination, then ensure serializeServerData round-trips
        const tree: NavigationNode = leaf("home", { q: "</script>" });
        const serverData = [
            { intent: { id: "home", params: { q: "</script>" } }, data: page("home") },
            // mirror navigationTreeSentinel shape (marked public is not required for parse-back)
            {
                intent: { id: NAVIGATION_TREE_INTENT_ID },
                data: { __finesoftNavigationTree: true, tree: serializeNavigation(tree) },
            },
        ];
        const serialized = serializeServerData(serverData);
        expect(serialized).not.toContain("</script>");
        const parsed = JSON.parse(
            serialized
                .replaceAll("\\u003C", "<")
                .replaceAll("\\u003E", ">")
                .replaceAll("\\u002F", "/"),
        ) as { intent: { id: string }; data: unknown }[];
        const restored = extractNavigationTree(parsed as never);
        expect(restored).toEqual(tree);
    });

    test("beforeLoad redirect short-circuits with an HTTP redirect (no render)", async () => {
        const renderApp = vi.fn(() => ({ html: "", head: "", css: "" }));
        const result = await ssrRenderNavigation({
            url: "/private",
            frameworkConfig: {},
            navigation: {
                codec: createActiveLeafCodec(),
                beforeLoad: [() => ({ kind: "redirect", url: "/login", status: 302 })],
            },
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/private",
                        intentId: "private",
                        controller: makeController("private", page("private")),
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp,
        });

        expect(result.redirect).toEqual({ url: "/login", status: 302 });
        expect(result.serverData).toEqual([]);
        expect(renderApp).not.toHaveBeenCalled();
    });

    test("beforeLoad deny marks the primary destination with the deny status (no dispatch)", async () => {
        const perform = vi.fn(() => page("private"));
        const result = await ssrRenderNavigation({
            url: "/private",
            frameworkConfig: {},
            navigation: {
                codec: createActiveLeafCodec(),
                beforeLoad: [() => ({ kind: "deny", status: 403, message: "Forbidden" })],
            },
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/private",
                        intentId: "private",
                        controller: { intentId: "private", perform },
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp(p) {
                return { html: p.title, head: "", css: "" };
            },
        });

        expect(result.status).toBe(403);
        expect(result.html).toBe("Forbidden");
        expect(perform).not.toHaveBeenCalled();
        // deny still commits a tree; sentinel rides along
        expect(extractNavigationTree(result.serverData)).toEqual(leaf("private"));
    });

    test("dispatch failure falls back to a 500 page on that destination without throwing", async () => {
        const result = await ssrRenderNavigation({
            url: "/broken",
            frameworkConfig: {},
            navigation: { codec: createActiveLeafCodec() },
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/broken",
                        intentId: "broken",
                        controller: {
                            intentId: "broken",
                            perform() {
                                throw new Error("boom");
                            },
                        },
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp(p) {
                return { html: p.title, head: "", css: "" };
            },
        });

        expect(result.status).toBe(500);
        expect(result.html).toBe("Internal error");
        expect(result.snapshot.destinations[0].status).toBe(500);
    });

    test("one failing column does not blow up the whole split render", async () => {
        const result = await ssrRenderNavigation({
            url: "/list",
            frameworkConfig: {},
            navigation: {
                codec: createActiveLeafCodec(),
                initial: () =>
                    split([
                        { id: "list", content: leaf("list") },
                        { id: "detail", content: leaf("detail") },
                    ]),
            },
            bootstrap(framework) {
                defineRoutes(framework, [
                    { path: "/list", intentId: "list", controller: makeEchoController("list") },
                    {
                        path: "/detail",
                        intentId: "detail",
                        controller: {
                            intentId: "detail",
                            perform() {
                                throw new Error("detail boom");
                            },
                        },
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp(_p, _fw, snapshot) {
                return {
                    html: snapshot.destinations
                        .map((d) => `${d.intent}:${d.status ?? "ok"}`)
                        .join("+"),
                    head: "",
                    css: "",
                };
            },
        });

        expect(result.html).toBe("list:ok+detail:500");
        expect(result.snapshot.destinations).toHaveLength(2);
    });

    test("renders a 404 page when no route matches and no overlay/initial", async () => {
        const result = await ssrRenderNavigation({
            url: "/missing",
            frameworkConfig: {},
            navigation: { codec: createActiveLeafCodec() },
            bootstrap() {},
            getErrorPage: makeErrorPage,
            renderApp(p) {
                return { html: p.title, head: "", css: "" };
            },
        });

        expect(result.html).toBe("Page not found");
        expect(result.serverData).toEqual([]);
    });

    test("returns an empty shell for csr routes (single-page fallback)", async () => {
        const renderApp = vi.fn();
        const result = await ssrRenderNavigation({
            url: "/dash",
            frameworkConfig: {},
            navigation: { codec: createActiveLeafCodec() },
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/dash",
                        intentId: "dash",
                        controller: makeController("dash", page("dash")),
                        renderMode: "csr",
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp,
        });

        expect(result.html).toBe("");
        expect(result.renderMode).toBe("csr");
        expect(result.serverData).toEqual([]);
        expect(renderApp).not.toHaveBeenCalled();
    });

    test("preserves single-page renderMode for a single LeafNode fallback", async () => {
        const result = await ssrRenderNavigation({
            url: "/static",
            frameworkConfig: {},
            navigation: { codec: createActiveLeafCodec() },
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/static",
                        intentId: "static",
                        controller: makeController("static", page("static")),
                        renderMode: "prerender",
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp(p) {
                return { html: p.title, head: "", css: "" };
            },
        });

        expect(result.renderMode).toBe("prerender");
        expect(result.html).toBe("static");
    });

    test("resolveLocale output flows into the result locale", async () => {
        const result = await ssrRenderNavigation({
            url: "/home",
            frameworkConfig: { locale: "en-US" },
            navigation: { codec: createActiveLeafCodec() },
            resolveLocale() {
                return { lang: "zh-Hans", dir: "ltr" };
            },
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/home",
                        intentId: "home",
                        controller: makeController("home", page("home")),
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp(p) {
                return { html: p.title, head: "", css: "" };
            },
        });

        expect(result.locale).toEqual({ lang: "zh-Hans", dir: "ltr" });
    });
});

describe("extractNavigationTree / stripNavigationTree", () => {
    test("extract returns undefined when no sentinel is present (single-page data)", () => {
        const data = [{ intent: { id: "home", params: {} }, data: page("home") }];
        expect(extractNavigationTree(data)).toBeUndefined();
        // strip is a no-op (content equivalent)
        expect(stripNavigationTree(data)).toEqual(data);
    });

    test("strip removes only the sentinel and keeps destination order", () => {
        const data = [
            { intent: { id: "a", params: {} }, data: page("a") },
            {
                intent: { id: NAVIGATION_TREE_INTENT_ID },
                data: { __finesoftNavigationTree: true, tree: serializeNavigation(leaf("a")) },
            },
            { intent: { id: "b", params: {} }, data: page("b") },
        ];
        const stripped = stripNavigationTree(data);
        expect(stripped.map((e) => e.intent.id)).toEqual(["a", "b"]);
    });

    test("an entry with the sentinel id but wrong shape is NOT treated as a tree", () => {
        // a real route accidentally named like the sentinel but without the marker field
        const data = [
            { intent: { id: NAVIGATION_TREE_INTENT_ID, params: {} }, data: page("decoy") },
        ];
        expect(extractNavigationTree(data)).toBeUndefined();
        expect(stripNavigationTree(data)).toEqual(data);
    });
});

describe("createSSRNavigationRender", () => {
    test("binds config and renders through ssrRenderNavigation", async () => {
        const render = createSSRNavigationRender({
            frameworkConfig: {},
            navigation: { codec: createActiveLeafCodec() },
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/",
                        intentId: "home",
                        controller: makeController("home", page("home")),
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp(p) {
                return { html: p.title, head: "", css: "" };
            },
        });

        const result = await render("/");
        expect(result.html).toBe("home");
        expect(extractNavigationTree(result.serverData)).toEqual(leaf("home"));
    });

    test("defaults frameworkConfig to an empty object", async () => {
        const render = createSSRNavigationRender({
            navigation: { codec: createActiveLeafCodec() },
            bootstrap(framework) {
                defineRoutes(framework, [
                    {
                        path: "/",
                        intentId: "home",
                        controller: makeController("home", page("home")),
                    },
                ]);
            },
            getErrorPage: makeErrorPage,
            renderApp(p) {
                return { html: p.title, head: "", css: "" };
            },
        });

        const result = await render("/");
        expect(result.html).toBe("home");
    });
});
