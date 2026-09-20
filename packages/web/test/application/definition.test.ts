import { routePages } from "../helpers/definition";
import { fixtureDefinition } from "../helpers/definition";
import { expect, test } from "vite-plus/test";
import { defineApp, ExecutionError } from "@finesoft/core";
import {
    createWebRuntime,
    getWebPlan,
    defineWebApp,
    loadPage,
    next,
    leaf,
    PrefetchedIntents,
} from "../../src/index";

const errorPage = (status: number, message: string) => ({
    id: String(status),
    pageType: "error",
    title: message,
});

test("reusable Web definition loads equivalent URL and leaf through all guards and Runtime", async () => {
    const order: string[] = [];
    const guard = (name: string) => () => {
        order.push(name);
        return next();
    };
    const web = defineWebApp({
        pages: routePages(
            [
                {
                    id: "home",
                    handler: () => {
                        order.push("controller");
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
        id: "web",
        beforeLoad: [guard("global-before")],
        afterLoad: [guard("global-after")],
        getErrorPage: errorPage,
    });
    expect(Object.isFrozen(web)).toBe(true);
    const fw = createWebRuntime({ definition: web });
    for (const target of ["/", leaf("home")]) {
        order.length = 0;
        const result = await loadPage({
            web: fw,
            target,
            beforeLoad: [guard("navigation-before")],
            afterLoad: [guard("navigation-after")],
        });
        expect(result.kind).toBe("page");
        expect(order).toEqual([
            "global-before",
            "route-before",
            "navigation-before",
            "controller",
            "global-after",
            "route-after",
            "navigation-after",
        ]);
    }
    await fw.dispose();
});

test("prefetch is consumed inside operation after app policies", async () => {
    const web = defineWebApp({
        pages: routePages(
            [{ id: "home", handler: () => ({ id: "actual", pageType: "home", title: "Home" }) }],
            [{ path: "/", intentId: "home" }],
        ),
        id: "web",
        app: defineApp({
            id: "data",
            policies: [
                (_, ctx) => {
                    if (ctx.bindings.denied) throw new ExecutionError("denied");
                },
            ],
        }),
        getErrorPage: errorPage,
    });
    const cached = { id: "cached", pageType: "home", title: "Cached" };
    const prefetch = PrefetchedIntents.fromArray([
        { entryId: "cached-entry", intent: { id: "home", params: {} }, data: cached },
    ]);
    const fw = createWebRuntime({
        definition: web,
        prefetchedIntents: prefetch,
        invocation: { bindings: { denied: true } },
    });
    await expect(
        fw.createExecution().execute(getWebPlan(web).operations.get("home")!, {}),
    ).rejects.toMatchObject({ code: "denied" });
    expect(prefetch.get({ id: "home", params: {} }, "cached-entry")).toBe(cached);
    await fw.dispose();
});

test("two URLs for one operation retain actual route policy and ambiguous intent requires URL", async () => {
    const web = defineWebApp({
        pages: routePages(
            [{ id: "home", handler: () => ({ id: "home", pageType: "home", title: "Home" }) }],
            [
                { path: "/public", intentId: "home" },
                {
                    path: "/private",
                    intentId: "home",
                    beforeLoad: [() => ({ kind: "deny", status: 403, message: "Denied" })],
                },
            ],
        ),
        id: "web",
        getErrorPage: errorPage,
    });
    const fw = createWebRuntime({ definition: web });
    expect((await loadPage({ web: fw, target: leaf("home", {}, { url: "/private" }) })).kind).toBe(
        "deny",
    );
    await expect(loadPage({ web: fw, target: leaf("home") })).rejects.toThrow(/ambiguous/i);
    await fw.dispose();
});

test("Split secondary guards block transaction commits and same target pushes retain separate pages", async () => {
    const { createNavigationController, split, stack } = await import("../../src/navigation");
    let calls = 0;
    let denied = false;
    const web = defineWebApp({
        pages: routePages(
            [
                {
                    id: "edit",
                    handler: () => ({ id: String(++calls), pageType: "edit", title: "Edit" }),
                },
            ],
            [
                {
                    path: "/edit",
                    intentId: "edit",
                    afterLoad: [
                        () => (denied ? { kind: "deny", status: 403, message: "Denied" } : next()),
                    ],
                },
            ],
        ),
        id: "nav",
        getErrorPage: errorPage,
    });
    const fw = createWebRuntime({ definition: web });
    const controller = createNavigationController({ web: fw, initial: stack(leaf("edit")) });
    const first = await controller.resolve();
    const second = await controller.push("edit");
    expect(second.destinations[0].entryId).not.toBe(first.destinations[0].entryId);
    expect(second.destinations[0].page).not.toBe(first.destinations[0].page);
    expect((await controller.pop()).destinations[0].page).toBe(first.destinations[0].page);
    let commits = 0;
    controller.subscribe(() => {
        commits++;
    });
    denied = true;
    await controller.hydrate(
        split([
            { id: "left", content: leaf("edit") },
            { id: "right", content: leaf("edit") },
        ]),
    );
    expect(commits).toBe(0);
    expect(controller.getSnapshot().destinations[0].entryId).toBe(first.destinations[0].entryId);
    await fw.dispose();
});

test("route-free leaf runs globals and navigation guards while unmatched URL remains 404", async () => {
    const calls: string[] = [];
    const web = defineWebApp({
        pages: routePages(
            [
                {
                    id: "panel",
                    handler: () => {
                        calls.push("controller");
                        return { id: "p", pageType: "panel", title: "Panel" };
                    },
                },
            ],
            [],
        ),
        id: "embedded",
        beforeLoad: [
            () => {
                calls.push("global");
                return next();
            },
        ],
        getErrorPage: errorPage,
    });
    const fw = createWebRuntime({ definition: web });
    expect(
        (
            await loadPage({
                web: fw,
                target: leaf("panel"),
                beforeLoad: [
                    () => {
                        calls.push("navigation");
                        return next();
                    },
                ],
            })
        ).kind,
    ).toBe("page");
    expect(calls).toEqual(["global", "navigation", "controller"]);
    expect(await loadPage({ web: fw, target: "/panel" })).toMatchObject({
        kind: "deny",
        status: 404,
    });
    expect(
        await loadPage({ web: fw, target: leaf("panel", {}, { url: "/missing" }) }),
    ).toMatchObject({ kind: "deny", status: 404 });
    await fw.dispose();
});

test("cancelling a transaction during guards prevents later guards, controllers and commits", async () => {
    const { createNavigationController, stack } = await import("../../src/navigation");
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const calls: string[] = [];
    const web = defineWebApp({
        pages: routePages(
            [
                {
                    id: "home",
                    handler: () => {
                        calls.push("controller");
                        return { id: "home", pageType: "home", title: "Home" };
                    },
                },
            ],
            [],
        ),
        id: "cancel",
        beforeLoad: [
            async () => {
                entered();
                await gate;
                return next();
            },
            () => {
                calls.push("late-guard");
                return next();
            },
        ],
        getErrorPage: errorPage,
    });
    const fw = createWebRuntime({ definition: web });
    const nav = createNavigationController({ web: fw, initial: stack(leaf("home")) });
    nav.subscribe(() => {
        calls.push("commit");
    });
    const pending = nav.resolve();
    await started;
    nav.cancel();
    release();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(calls).toEqual([]);
    expect(nav.getSnapshot().destinations).toEqual([]);
    await fw.dispose();
});

test("assembled route indexes cannot be mutated through a request facade", async () => {
    const web = defineWebApp({
        pages: routePages(
            [{ id: "home", handler: () => ({ id: "home", pageType: "home", title: "Home" }) }],
            [{ path: "/", intentId: "home" }],
        ),
        id: "sealed",
        getErrorPage: errorPage,
    });
    const fw = createWebRuntime({ definition: web });
    expect(() => fw.router.add("/injected", "home")).toThrow(/sealed/i);
    await fw.dispose();
});

test("facade disposal finishes environment and owned Runtime even if execution cleanup fails", async () => {
    const fw = createWebRuntime({ definition: fixtureDefinition() });
    const execution = fw.createExecution();
    execution.context.onDispose(() => {
        throw new Error("cleanup failed");
    });
    await expect(fw.dispose()).rejects.toThrow();
    expect(() => fw.runtime.createExecution()).toThrow();
});

test("disposed navigation rejects new work even when its shared facade is still alive", async () => {
    const { createNavigationController, stack } = await import("../../src/navigation");
    const fw = createWebRuntime({ definition: fixtureDefinition() });
    const nav = createNavigationController({ web: fw, initial: stack(leaf("home")) });
    await nav.dispose();
    await expect(nav.resolve()).rejects.toMatchObject({
        code: "configuration",
        message: "Navigation is closed",
    });
    await fw.dispose();
});

test("Web definitions own an immutable navigation declaration snapshot", async () => {
    const { stack } = await import("../../src/navigation");
    const params = { draft: "initial" };
    const initial = stack(leaf("home", params));
    const web = defineWebApp({
        pages: routePages([], []),
        id: "immutable",
        navigation: initial,
        getErrorPage: errorPage,
    });
    params.draft = "changed";
    expect(web.navigation).toMatchObject({ entries: [{ params: { draft: "initial" } }] });
    expect(Object.isFrozen(web.navigation)).toBe(true);
});

test("before-load rewrite preserves the destination EntryId across tree, data and serialization", async () => {
    const { createNavigationController, stack, serializeNavigation } =
        await import("../../src/navigation");
    const web = defineWebApp({
        pages: routePages(
            [{ id: "home", handler: () => ({ id: "home", pageType: "home", title: "Home" }) }],
            [
                {
                    path: "/old",
                    intentId: "home",
                    beforeLoad: [() => ({ kind: "rewrite", url: "/new" })],
                },
                { path: "/new", intentId: "home" },
            ],
        ),
        id: "rewrite-entry",
        getErrorPage: errorPage,
    });
    const fw = createWebRuntime({ definition: web });
    const initial = leaf("home", {}, { url: "/old" });
    const nav = createNavigationController({ web: fw, initial: stack(initial) });
    const snapshot = await nav.resolve();
    expect(snapshot.destinations[0].entryId).toBe(initial.entryId);
    expect(serializeNavigation(snapshot.tree)).toMatchObject({
        entries: [{ entryId: initial.entryId, url: "/new" }],
    });
    await fw.dispose();
});

test.each(["loader", "tree"] as const)(
    "%s cancellation reaches supplied execution controller, nested fetch and query cache without disposing it",
    async (producer) => {
        const { defineOperation } = await import("@finesoft/core");
        const { createNavigationController } = await import("../../src/navigation");
        let start!: () => void, release!: () => void;
        const started = new Promise<void>((resolve) => {
            start = resolve;
        });
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let calls = 0,
            cleaned = 0;
        let controllerSignal: AbortSignal | undefined, fetchSignal: AbortSignal | undefined;
        const query = defineOperation({
            id: "nested",
            kind: "query",
            cache: { ttlMs: 10000 },
            handler: async (_input: undefined, ctx) => {
                calls++;
                ctx.onDispose(() => {
                    cleaned++;
                });
                return await (await ctx.fetch("https://example.com/data")).text();
            },
        });
        const framework = createWebRuntime({
            definition: defineWebApp({
                pages: routePages(
                    [
                        {
                            id: "home",
                            handler: async (_params, ctx) => {
                                controllerSignal = ctx.signal;
                                return {
                                    id: "home",
                                    pageType: "home",
                                    title: await ctx.execute(query, undefined),
                                };
                            },
                        },
                    ],
                    [],
                ),
                id: "supplied-cancel",
                app: defineApp({ id: "data", operations: [query] }),
                getErrorPage: errorPage,
            }),
            fetch: async (_input, init) => {
                fetchSignal = init!.signal!;
                start();
                await gate;
                return new Response("late");
            },
        });
        const execution = framework.createExecution();
        const nav = createNavigationController({
            web: framework,
            execution,
            initial: leaf("home"),
        });
        const abort = new AbortController();
        const pending =
            producer === "loader"
                ? loadPage({
                      web: framework,
                      target: leaf("home"),
                      execution,
                      signal: abort.signal,
                  })
                : nav.resolve();
        const outcome = pending.then(
            () => "fulfilled",
            (error: unknown) => (error as ExecutionError).code,
        );
        await started;
        if (producer === "loader") abort.abort("private cancellation reason");
        else nav.cancel();
        const signalWasAborted = execution.context.signal.aborted;
        release();
        expect(await outcome).toBe("cancelled");
        expect(signalWasAborted).toBe(true);
        expect(controllerSignal).toBe(execution.context.signal);
        expect(fetchSignal?.aborted).toBe(true);
        expect(nav.getSnapshot().destinations).toEqual([]);
        expect(cleaned).toBe(0);
        await expect(execution.execute(query, undefined)).rejects.toMatchObject({
            code: "cancelled",
        });
        expect(
            await framework.runtime.execute(query, undefined, {
                fetch: async () => new Response("fresh"),
            }),
        ).toBe("fresh");
        expect(calls).toBe(2);
        expect(cleaned).toBe(1); // only the automatically owned retry execution is disposed
        await execution.dispose();
        expect(cleaned).toBe(2);
        await nav.dispose();
        await framework.dispose();
    },
);

test.each(["loader", "tree"] as const)(
    "%s detaches completed signal bindings and forwards already-aborted signals",
    async (producer) => {
        const { createNavigationController } = await import("../../src/navigation");
        let calls = 0;
        const framework = createWebRuntime({
            definition: defineWebApp({
                pages: routePages(
                    [
                        {
                            id: "home",
                            handler: () => {
                                calls++;
                                return { id: "home", pageType: "home", title: "Home" };
                            },
                        },
                    ],
                    [],
                ),
                id: "signal-boundary",
                getErrorPage: errorPage,
            }),
        });
        const execution = framework.createExecution();
        const target = leaf("home");
        const nav = createNavigationController({ web: framework, execution, initial: target });
        const run = (signal: AbortSignal) =>
            producer === "loader"
                ? loadPage({ web: framework, execution, target, signal })
                : nav.apply({ kind: "hydrate", tree: target }, { signal });
        const completed = new AbortController();
        await run(completed.signal);
        completed.abort();
        expect(execution.context.signal.aborted).toBe(false);
        const cancelled = new AbortController();
        cancelled.abort();
        await expect(run(cancelled.signal)).rejects.toMatchObject({ code: "cancelled" });
        expect(execution.context.signal.aborted).toBe(true);
        expect(calls).toBe(1);
        await nav.dispose();
        await execution.dispose();
        await framework.dispose();
    },
);
