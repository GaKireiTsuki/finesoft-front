vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
import { expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import {
    createActiveLeafCodec,
    createFullStateCodec,
    createNavigationController,
    createWebRuntime,
    defineWebApp,
    deserializeNavigation,
    leaf,
    PrefetchedIntents,
    split,
    stack,
    tabs,
} from "@finesoft/web";
import { routePages } from "../../web/test/helpers/definition";
import { createSSRRender } from "../src/create-render";

const errorPage = (status: number, message: string) => ({
    id: String(status),
    pageType: "error",
    title: message,
});

test("a single leaf tree renders through the shared app view and serializes its tree", async () => {
    const home = { id: "home", pageType: "home", title: "Home" };
    const definition = defineWebApp({
        id: "single-tree",
        navigationCodec: createActiveLeafCodec(),
        pages: routePages([{ id: "home", handler: () => home }], [{ path: "/", intentId: "home" }]),
        getErrorPage: errorPage,
    });
    const render = createSSRRender({
        definition,
        render: (app) =>
            app
                .getSnapshot()
                .destinations.map((entry) => entry.page.title)
                .join("+"),
    });
    const result = await render("/?from=test");
    expect(result.html).toBe("Home");
    expect(result.serverData.pages).toHaveLength(1);
    expect(result.serverData.pages[0]).toMatchObject({
        intent: { id: "home", params: { from: "test" } },
        data: home,
    });
    expect(result.serverData.tree).toMatchObject({
        kind: "stack",
        entries: [{ kind: "leaf", intent: "home", params: { from: "test" } }],
    });
    expect(result.serverData.pages[0]!.data).not.toBe(home);
    await render.dispose();
});

test("split navigation renders every visible column in order and prefetches each page", async () => {
    const calls: string[] = [];
    const definition = defineWebApp({
        id: "split-tree",
        navigation: split([
            { id: "list", content: leaf("list") },
            { id: "detail", content: leaf("detail", { itemId: "42" }) },
        ]),
        pages: routePages(
            [
                {
                    id: "list",
                    handler: () => {
                        calls.push("list");
                        return { id: "list", pageType: "list", title: "list" };
                    },
                },
                {
                    id: "detail",
                    handler: (params) => {
                        calls.push("detail");
                        return { id: "detail", pageType: "detail", title: String(params.itemId) };
                    },
                },
            ],
            [
                { path: "/list", intentId: "list" },
                { path: "/detail/:itemId", intentId: "detail" },
            ],
        ),
        getErrorPage: errorPage,
    });
    const render = createSSRRender({
        definition,
        render: (app) =>
            app
                .getSnapshot()
                .entries.filter((entry) => entry.visible)
                .map((entry) => entry.page.title)
                .join("+"),
    });
    const result = await render("/list");
    expect(result.html).toBe("list+42");
    expect(calls).toEqual(["list", "detail"]);
    expect(result.serverData.pages).toHaveLength(2);
    expect(result.serverData.pages.map((entry) => entry.intent.id)).toEqual(["list", "detail"]);
    await render.dispose();
});

test("tabs navigation resolves only the active branch", async () => {
    const inactive = vi.fn(() => ({ id: "settings", pageType: "settings", title: "Settings" }));
    const definition = defineWebApp({
        id: "tabs-tree",
        navigation: tabs({
            active: "home",
            branches: {
                home: stack(leaf("home")),
                settings: stack(leaf("settings")),
            },
        }),
        pages: routePages(
            [
                { id: "home", handler: () => ({ id: "home", pageType: "home", title: "Home" }) },
                { id: "settings", handler: inactive },
            ],
            [
                { path: "/home", intentId: "home" },
                { path: "/settings", intentId: "settings" },
            ],
        ),
        getErrorPage: errorPage,
    });
    const render = createSSRRender({
        definition,
        render: (app) =>
            app
                .getSnapshot()
                .destinations.map((entry) => entry.intent)
                .join("+"),
    });
    await expect(render("/home")).resolves.toMatchObject({ html: "home" });
    expect(inactive).not.toHaveBeenCalled();
    await render.dispose();
});

test("full-state navigation codec restores a deep linked composed tree", async () => {
    const codec = createFullStateCodec();
    const deepTree = stack([leaf("home"), leaf("detail", { id: "7" })]);
    const url = codec.encode(deepTree, { reverse: () => undefined });
    const definition = defineWebApp({
        id: "full-state",
        navigationCodec: codec,
        pages: routePages(
            [
                { id: "home", handler: () => ({ id: "home", pageType: "home", title: "Home" }) },
                {
                    id: "detail",
                    handler: (params) => ({
                        id: "detail",
                        pageType: "detail",
                        title: String(params.id),
                    }),
                },
            ],
            [
                { path: "/home", intentId: "home" },
                { path: "/detail/:id", intentId: "detail" },
            ],
        ),
        getErrorPage: errorPage,
    });
    const render = createSSRRender({
        definition,
        render: (app) => app.getSnapshot().destinations[0]!.page.title,
    });
    const result = await render(url);
    expect(result.html).toBe("7");
    expect(result.serverData.tree).toMatchObject({
        kind: "stack",
        entries: [{ intent: "home" }, { intent: "detail", params: { id: "7" } }],
    });
    expect(result.serverData.pages.map((entry) => entry.intent.id)).toEqual(["detail"]);
    await render.dispose();
});

test("SSR pages hydrate the same composed tree without refetching", async () => {
    let calls = 0;
    const definition = defineWebApp({
        id: "hydrate-tree",
        navigation: split([
            { id: "left", content: leaf("left") },
            { id: "right", content: leaf("right") },
        ]),
        pages: routePages(
            [
                {
                    id: "left",
                    handler: () => ({ id: `left-${++calls}`, pageType: "left", title: "Left" }),
                },
                {
                    id: "right",
                    handler: () => ({ id: `right-${++calls}`, pageType: "right", title: "Right" }),
                },
            ],
            [
                { path: "/left", intentId: "left" },
                { path: "/right", intentId: "right" },
            ],
        ),
        getErrorPage: errorPage,
    });
    const render = createSSRRender({ definition, render: () => "SSR" });
    const output = await render("/left");
    expect(calls).toBe(2);
    const browser = createWebRuntime({
        definition,
        prefetchedIntents: PrefetchedIntents.fromArray(output.serverData.pages),
    });
    const controller = createNavigationController({
        web: browser,
        initial: deserializeNavigation(output.serverData.tree!),
        isServer: false,
    });
    const snapshot = await controller.resolve();
    expect(snapshot.destinations.map((entry) => entry.page.id)).toEqual(["left-1", "right-2"]);
    expect(calls).toBe(2);
    await controller.dispose();
    await browser.dispose();
    await render.dispose();
});
