vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
import { expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import { defineWebApp, deny, leaf, next, split, encodeNavigationTreeParam } from "@finesoft/web";
import { routePages } from "../../web/test/helpers/definition";
import { createSSRRender } from "../src/create-render";

const errorPage = (status: number, message: string) => ({
    id: String(status),
    pageType: "error",
    title: message,
});

test.each(["missing", "denied", "fault"])(
    "initial URL navigation never discloses a successful sibling of %s",
    async (failure) => {
        const commit = vi.fn(() => deny(403, "Whole-tree denial"));
        const definition = defineWebApp({
            id: "mixed-failure",
            pages: routePages(
                [
                    {
                        id: "secret",
                        handler: () => ({
                            id: "secret",
                            pageType: "secret",
                            title: "PRIVATE_SIBLING",
                        }),
                    },
                    {
                        id: "denied",
                        handler: () => ({ id: "denied", pageType: "denied", title: "denied" }),
                    },
                    {
                        id: "fault",
                        handler: () => {
                            throw new Error("failure");
                        },
                    },
                ],
                [{ path: "/secret", intentId: "secret" }],
            ),
            getErrorPage: errorPage,
            beforeLoad: [(ctx) => (ctx.intent.id === "denied" ? deny(401, "Sign in") : next())],
            beforeCommit: [commit],
        });
        const render = createSSRRender({
            definition,
            render: (app) => JSON.stringify(app.getSnapshot()),
        });
        try {
            for (const order of [
                [failure, "secret"],
                ["secret", failure],
            ]) {
                const tree = split(
                    order.map((intent, i) => ({ id: String(i), content: leaf(intent) })),
                );
                const result = await render(`/secret?__nav=${encodeNavigationTreeParam(tree)}`);
                expect(JSON.stringify(result)).not.toContain("PRIVATE_SIBLING");
                expect(result.status).toBe(
                    failure === "missing" ? 404 : failure === "denied" ? 401 : 500,
                );
                expect(result.serverData).toEqual({ pages: [] });
                expect(result.cache).toBeUndefined();
            }
            const denied = await render("/secret");
            expect(denied.status).toBe(403);
            expect(JSON.stringify(denied)).not.toContain("PRIVATE_SIBLING");
            expect(commit).toHaveBeenCalledTimes(1);
        } finally {
            await render.dispose();
        }
    },
);

test("SSR runs admission and commit policies around one shared native presentation", async () => {
    const events: string[] = [];
    let rejected = true;
    const definition = defineWebApp({
        id: "ssr-policy",
        pages: routePages(
            [
                {
                    id: "home",
                    handler: (_params, context) => {
                        events.push("load");
                        context.onDispose(() => {
                            events.push("dispose");
                        });
                        return { id: "home", title: "secret", pageType: "home" };
                    },
                },
            ],
            [{ path: "/", intentId: "home", cache: "public" }],
        ),
        getErrorPage: errorPage,
        beforeNavigate: [
            (context) => {
                expect(context.isServer).toBe(true);
                expect(context.execution.bindings.request).toBeInstanceOf(Request);
                events.push("admission");
                return next();
            },
        ],
        beforeCommit: [
            (context) => {
                expect(context.candidate.destinations).toHaveLength(1);
                events.push("commit");
                return rejected ? deny(409, "draft") : next();
            },
        ],
    });
    const render = createSSRRender({
        definition,
        render: (app) => {
            events.push("render");
            return app.getSnapshot().entries.at(-1)?.page.title ?? "";
        },
    });
    const request = new Request("https://app.local/");
    const denied = await render("/", { request });
    expect(denied.status).toBe(409);
    expect(denied.html).toBe("draft");
    expect(denied.serverData).toEqual({ pages: [] });
    expect(denied.cache).toBeUndefined();
    expect(events).toEqual(["admission", "load", "commit", "render", "dispose"]);

    events.length = 0;
    rejected = false;
    const accepted = await render("/", { request });
    expect(accepted.html).toBe("secret");
    expect(accepted.status).toBeUndefined();
    expect(accepted.cache).toBe("public");
    expect(events).toEqual(["admission", "load", "commit", "render", "dispose"]);
    await render.dispose();
});

test("admission redirect returns HTTP metadata without loading or rendering", async () => {
    const load = vi.fn(() => ({ id: "home", title: "home", pageType: "home" }));
    const native = vi.fn(() => "unexpected");
    const definition = defineWebApp({
        id: "redirect-policy",
        pages: routePages([{ id: "home", handler: load }], [{ path: "/", intentId: "home" }]),
        getErrorPage: errorPage,
        beforeNavigate: [() => ({ kind: "redirect", url: "/login", status: 307 })],
    });
    const render = createSSRRender({ definition, render: native });
    await expect(render("/")).resolves.toMatchObject({
        redirect: { url: "/login", status: 307 },
        serverData: { pages: [] },
    });
    expect(load).not.toHaveBeenCalled();
    expect(native).not.toHaveBeenCalled();
    await render.dispose();
});

test("commit denial replaces a composed candidate with only the error presentation", async () => {
    let candidateDestinations = 0;
    let loads = 0;
    const definition = defineWebApp({
        id: "composed-denial",
        navigation: split([
            { id: "left", content: leaf("left") },
            { id: "right", content: leaf("right") },
        ]),
        pages: routePages(
            [
                {
                    id: "left",
                    handler: () => {
                        loads++;
                        return { id: "left", pageType: "left", title: "PRIVATE_LEFT" };
                    },
                },
                {
                    id: "right",
                    handler: () => {
                        loads++;
                        return { id: "right", pageType: "right", title: "PRIVATE_RIGHT" };
                    },
                },
            ],
            [
                { path: "/left", intentId: "left" },
                { path: "/right", intentId: "right" },
            ],
        ),
        getErrorPage: errorPage,
        beforeCommit: [
            (context) => {
                candidateDestinations = context.candidate.destinations.length;
                return deny(403, "Denied");
            },
        ],
    });
    const render = createSSRRender({
        definition,
        render: (app) => {
            const snapshot = app.getSnapshot();
            expect(snapshot.entries).toHaveLength(1);
            expect(snapshot.entries[0]!.page.title).toBe("Denied");
            expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE|left|right/);
            return snapshot.entries[0]!.page.title;
        },
    });
    const result = await render("/left");
    expect(result.status).toBe(403);
    expect(result.html).toBe("Denied");
    expect(result.serverData).toEqual({ pages: [] });
    expect(candidateDestinations).toBe(2);
    expect(loads).toBe(2);
    await render.dispose();
});
