import { expect, test, vi } from "vite-plus/test";
vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));
import {
    defineWebApp,
    next,
    deny,
    stack,
    split,
    leaf,
    type NavigationSnapshot,
} from "@finesoft/web";
import { createSSRRender } from "../src/create-render";
import { createSSRNavigationRender } from "../src/navigation";

test.each(["flat", "navigation"] as const)(
    "%s SSR honors admission/commit policies before rendering and materialization",
    async (strategy) => {
        const events: string[] = [];
        let rejected = true;
        const definition = defineWebApp({
            id: "ssr-policy",
            controllers: [
                {
                    id: "home",
                    handler: (_p, ctx) => {
                        events.push("load");
                        ctx.onDispose(() => {
                            events.push("dispose");
                        });
                        return { id: "home", title: "secret", pageType: "home" };
                    },
                },
            ],
            routes: [{ path: "/", intentId: "home", cache: "public" }],
            getErrorPage: (_, title) => ({ id: "error", title, pageType: "error" }),
            beforeNavigate: [
                (ctx) => {
                    expect(ctx.isServer).toBe(true);
                    expect(ctx.execution.bindings.request).toBeInstanceOf(Request);
                    events.push("admission");
                    return next();
                },
            ],
            beforeCommit: [
                (ctx) => {
                    expect(ctx.candidate.destinations).toHaveLength(1);
                    events.push("commit");
                    return rejected ? deny(409, "draft") : next();
                },
            ],
        });
        const config = {
            definition,
            renderApp: (page: { title?: string }) => {
                events.push("render");
                return { html: page.title ?? "", head: "", css: "" };
            },
        };
        const render =
            strategy === "flat" ? createSSRRender(config) : createSSRNavigationRender(config);
        const denied = await render("/", { request: new Request("https://app.local/") });
        expect(denied.status).toBe(409);
        expect(denied.html).toBe("draft");
        expect(denied.serverData).toEqual([]);
        expect(denied.cache).toBeUndefined();
        expect(events).toEqual(["admission", "load", "commit", "render", "dispose"]);
        events.length = 0;
        rejected = false;
        const accepted = await render("/", { request: new Request("https://app.local/") });
        expect(accepted.html).toBe("secret");
        expect(accepted.status).toBeUndefined();
        expect(events).toEqual(["admission", "load", "commit", "render", "dispose"]);
        await render.dispose();
    },
);
test.each(["flat", "navigation"] as const)(
    "%s SSR transaction redirect returns HTTP metadata without loading",
    async (strategy) => {
        const load = vi.fn(() => ({ id: "home", title: "home", pageType: "home" }));
        const definition = defineWebApp({
            id: "redirect-policy",
            controllers: [{ id: "home", handler: load }],
            routes: [{ path: "/", intentId: "home" }],
            getErrorPage: (_, title) => ({ id: "error", title, pageType: "error" }),
            beforeNavigate: [() => ({ kind: "redirect", url: "/login", status: 307 })],
        });
        const config = { definition, renderApp: () => ({ html: "", head: "", css: "" }) };
        const render =
            strategy === "flat" ? createSSRRender(config) : createSSRNavigationRender(config);
        expect((await render("/")).redirect).toEqual({ url: "/login", status: 307 });
        expect(load).not.toHaveBeenCalled();
        await render.dispose();
    },
);
test("navigation SSR rejects empty-tree transactions with explicit status and no wire tree", async () => {
    const definition = defineWebApp({
        id: "empty",
        routes: [],
        navigation: stack([]),
        getErrorPage: (_, title) => ({ id: "error", title, pageType: "error" }),
        beforeNavigate: [() => deny(409, "draft")],
    });
    const render = createSSRNavigationRender({
        definition,
        renderApp: (page) => ({ html: page.title, head: "", css: "" }),
    });
    const result = await render("/");
    expect(result.status).toBe(409);
    expect(result.html).toBe("draft");
    expect(result.serverData).toEqual([]);
    await render.dispose();
});

test.each(["beforeNavigate", "beforeCommit"] as const)(
    "%s denial exposes only an error presentation to SSR snapshot consumers",
    async (phase) => {
        for (const shape of ["route", "split", "empty"] as const) {
            let candidate: NavigationSnapshot | undefined;
            let presented: NavigationSnapshot | undefined;
            let loads = 0;
            let disposals = 0;
            const definition = defineWebApp({
                id: "denied-presentation",
                routes: [{ path: "/", intentId: "secret", cache: "public" }],
                navigation:
                    shape === "empty"
                        ? stack([])
                        : shape === "split"
                          ? split([
                                { id: "left", content: leaf("secret", { token: "PRIVATE_LEFT" }) },
                                {
                                    id: "right",
                                    content: leaf("secret", { token: "PRIVATE_RIGHT" }),
                                },
                            ])
                          : undefined,
                controllers: [
                    {
                        id: "secret",
                        handler: (_params, ctx) => {
                            loads++;
                            ctx.onDispose(() => {
                                disposals++;
                            });
                            return { id: "secret", title: "PRIVATE_PAGE", pageType: "secret" };
                        },
                    },
                ],
                getErrorPage: (_, title) => ({ id: "error", title, pageType: "error" }),
                beforeNavigate: phase === "beforeNavigate" ? [() => deny(403, "Denied")] : [],
                beforeCommit:
                    phase === "beforeCommit"
                        ? [
                              (ctx) => {
                                  candidate = ctx.candidate;
                                  return deny(403, "Denied");
                              },
                          ]
                        : [],
            });
            const render = createSSRNavigationRender({
                definition,
                renderApp: async (page, _framework, snapshot) => {
                    await Promise.resolve();
                    expect(disposals).toBe(0);
                    presented = snapshot;
                    expect(snapshot.destinations).toHaveLength(1);
                    expect(snapshot.destinations[0].page).toBe(page);
                    expect(snapshot.destinations[0].params).toEqual({});
                    expect(snapshot.destinations[0].cache).toBeUndefined();
                    expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE|secret/);
                    expect(snapshot.tree).toEqual(
                        stack(
                            leaf(
                                "@finesoft/rejected",
                                {},
                                {
                                    entryId: snapshot.destinations[0].entryId,
                                },
                            ),
                        ),
                    );
                    return { html: page.title, head: "", css: "" };
                },
            });
            try {
                const result = await render("/");
                expect(result.snapshot).toBe(presented);
                expect(result.snapshot.rejection).toEqual(deny(403, "Denied"));
                expect(result.status).toBe(403);
                expect(result.serverData).toEqual([]);
                expect(result.cache).toBeUndefined();
                expect(disposals).toBe(loads);
                if (phase === "beforeNavigate") expect(loads).toBe(0);
                if (candidate) {
                    expect(candidate).not.toBe(presented);
                    expect(candidate.destinations).toHaveLength(
                        shape === "empty" ? 0 : shape === "split" ? 2 : 1,
                    );
                    expect(
                        candidate.destinations.every(
                            (entry) => entry.page.title === "PRIVATE_PAGE",
                        ),
                    ).toBe(true);
                }
            } finally {
                await render.dispose();
            }
        }
    },
);
