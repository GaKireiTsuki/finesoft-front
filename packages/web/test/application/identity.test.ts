import { routePages } from "../helpers/definition";
import { expect, test } from "vite-plus/test";
import { str, list } from "@finesoft/core";
import { leaf, stack, serializeNavigation, deserializeNavigation } from "../../src/navigation";
import { collectLeafKeys } from "../../src/session/scoped-state";

test("equal targets keep independent entry drafts through serialization", () => {
    const a = leaf("edit", { id: 7 }),
        b = leaf("edit", { id: 7 });
    expect(a.entryId).not.toBe(b.entryId);
    const tree = stack([a, b]);
    const restored = deserializeNavigation(JSON.parse(JSON.stringify(serializeNavigation(tree))));
    expect(restored).toEqual(tree);
    expect([...collectLeafKeys(restored)]).toEqual([a.entryId, b.entryId]);
});

test("serialized duplicate EntryIds are rejected", () => {
    const a = leaf("edit", { id: 7 });
    expect(() => deserializeNavigation(serializeNavigation(stack([a, a])))).toThrow(
        /duplicate.*entry/i,
    );
});

test("query survives restore and participates in retained-page and prefetch identity", async () => {
    const {
        createWebRuntime,
        definePage,
        defineWebApp,
        createWebSession,
        PrefetchedIntents,
        loadPage,
    } = await import("../../src/index");
    const search = definePage({
        id: "search",
        routes: [{ path: "/search", query: { q: str(), tags: list(str()) } }],
        handler: (_params, _context, query) => ({
            id: "search",
            pageType: "search",
            title: query.q,
        }),
    });
    const target = search.leaf({}, { query: { q: "first", tags: ["a", "b"] } });
    const restored = deserializeNavigation(JSON.parse(JSON.stringify(serializeNavigation(target))));
    expect(restored).toEqual(target);
    expect(() => deserializeNavigation({ ...serializeNavigation(target), query: [] })).toThrow(
        /query/,
    );
    const definition = defineWebApp({
        id: "query-identity",
        pages: [search],
        getErrorPage: (_, title) => ({ id: "error", pageType: "error", title }),
    });
    const prefetched = PrefetchedIntents.fromArray([
        {
            entryId: target.entryId,
            intent: { id: "search", params: {}, query: { q: "first", tags: ["a", "b"] } },
            data: { id: "cached", pageType: "search", title: "Cached" },
        },
    ]);
    const web = createWebRuntime({ definition, prefetchedIntents: prefetched });
    const session = createWebSession({ web, initial: stack(restored) });
    try {
        // A different query must not consume this entry's prefetched result.
        expect(
            await loadPage({ web, target: { ...target, query: { q: "second", tags: [] } } }),
        ).toMatchObject({ kind: "page", page: { title: "second" } });
        expect(prefetched.size).toBe(1);
        expect((await session.start()).destinations[0].page.title).toBe("Cached");
        await session.perform({
            kind: "hydrate",
            tree: stack({ ...target, query: { q: "second", tags: [] } }),
        });
        expect(session.getSnapshot().destinations[0].page.title).toBe("second");
    } finally {
        await session.dispose();
        await web.dispose();
    }
});

test("same-target prefetch values hydrate their own EntryIds without overwriting", async () => {
    const { createWebRuntime, defineWebApp, PrefetchedIntents, loadPage } =
        await import("../../src/index");
    const a = leaf("edit", { id: 7 }),
        b = leaf("edit", { id: 7 });
    const page = (id: string) => ({ id, pageType: "edit", title: id });
    const fw = createWebRuntime({
        definition: defineWebApp({
            pages: routePages([{ id: "edit", handler: () => page("refetched") }], []),
            id: "prefetch",
            getErrorPage: (_status, message) => page(message),
        }),
        prefetchedIntents: PrefetchedIntents.fromArray([
            {
                entryId: a.entryId,
                intent: { id: "edit", params: { id: 7 } },
                data: page("draft-a"),
            },
            {
                entryId: b.entryId,
                intent: { id: "edit", params: { id: 7 } },
                data: page("draft-b"),
            },
        ]),
    });
    expect(await loadPage({ web: fw, target: a })).toMatchObject({
        kind: "page",
        page: page("draft-a"),
    });
    expect(await loadPage({ web: fw, target: b })).toMatchObject({
        kind: "page",
        page: page("draft-b"),
    });
    expect(fw.prefetchedIntents.size).toBe(0);
    await fw.dispose();
});

test("equal targets own separate drafts while sharing an opt-in query result; explicit reuse selects an EntryId", async () => {
    const { createWebRuntime, defineWebApp, createWebSession, createNavigationScopedState } =
        await import("../../src/index");
    const { defineApp, defineOperation } = await import("@finesoft/core");
    let calls = 0;
    const query = defineOperation({
        id: "product",
        kind: "query",
        handler: () => {
            calls++;
            return { name: "Product" };
        },
        cache: { ttlMs: 10000, partition: () => "public-product" },
    });
    const web = defineWebApp({
        pages: routePages(
            [
                {
                    id: "edit",
                    handler: async (_params, ctx) => ({
                        id: "7",
                        pageType: "edit",
                        title: "Edit",
                        product: await ctx.execute(query, undefined),
                    }),
                },
            ],
            [],
        ),
        id: "drafts",
        app: defineApp({ id: "business", operations: [query] }),
        getErrorPage: (status, message) => ({
            id: String(status),
            pageType: "error",
            title: message,
        }),
    });
    const fw = createWebRuntime({
        definition: web,
        invocation: { identity: "alice", locale: "en" },
    });
    const nav = createWebSession({
        web: fw,
        initial: stack(leaf("edit", { id: 7 })),
    });
    const first = (await nav.perform({ kind: "hydrate", tree: nav.getTree() })).destinations[0];
    const second = (await nav.perform({ kind: "push", intent: "edit", params: { id: 7 } }))
        .destinations[0];
    const state = createNavigationScopedState();
    state.set(first.entryId, { draft: "one" });
    state.set(second.entryId, { draft: "two" });
    expect(state.get(first.entryId)).toEqual({ draft: "one" });
    expect(state.get(second.entryId)).toEqual({ draft: "two" });
    expect(first.resourceKey).toBe(second.resourceKey);
    expect(first.page).not.toBe(second.page);
    expect((first.page as unknown as { product: object }).product).toBe(
        (second.page as unknown as { product: object }).product,
    );
    expect(calls).toBe(1);
    expect(
        (await nav.perform({ kind: "reuseEntry", entryId: first.entryId })).destinations[0].page,
    ).toBe(first.page);
    await fw.dispose();
});
