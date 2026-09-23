import { routePages } from "../helpers/definition";
import { expect, test, vi } from "vite-plus/test";
import {
    createWebRuntime,
    defineWebApp,
    createWebSession,
    leaf,
    stack,
    split,
    next,
    deny,
    redirect,
    PrefetchedIntents,
} from "../../src/index";
import type { WebAppDefinition } from "../../src/index";
function fixture(policies: Partial<WebAppDefinition> = {}) {
    const events: string[] = [];
    const definition = defineWebApp({
        pages: routePages(
            ["home", "other"].map((id) => ({
                id,
                handler: () => {
                    events.push(`load:${id}`);
                    return { id, pageType: id, title: id };
                },
            })),
            [
                { path: "/", intentId: "home" },
                { path: "/other", intentId: "other" },
            ],
        ),
        id: "transaction",
        getErrorPage: (_, title) => ({ id: "error", pageType: "error", title }),
        ...policies,
    });
    const framework = createWebRuntime({ definition });
    const controller = createWebSession({
        web: framework,
        initial: stack(leaf("home")),
        isServer: false,
    });
    return { web: framework, controller, events };
}

test("initial browser failures publish only an error and can retry without retaining successful sibling data", async () => {
    let broken = true;
    const definition = defineWebApp({
        id: "initial-failure",
        pages: routePages(
            [
                {
                    id: "left",
                    handler: () => {
                        if (broken) throw Error("broken");
                        return { id: "left", pageType: "left", title: "left" };
                    },
                },
                {
                    id: "secret",
                    handler: () => ({
                        id: "secret",
                        pageType: "secret",
                        title: "PRIVATE_BROWSER_SIBLING",
                    }),
                },
            ],
            [],
        ),
        getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
        beforeCommit: [() => next()],
    });
    const web = createWebRuntime({ definition });
    const controller = createWebSession({
        web,
        isServer: false,
        initial: split([
            { id: "left", content: leaf("left") },
            { id: "right", content: leaf("secret") },
        ]),
    });
    try {
        const failed = await controller.start();
        expect(failed.entries).toHaveLength(1);
        expect(failed.entries[0].status).toBe(500);
        expect(JSON.stringify(failed)).not.toContain("PRIVATE_BROWSER_SIBLING");
        broken = false;
        await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        expect(controller.getSnapshot().entries).toHaveLength(2);
        expect(JSON.stringify(controller.getSnapshot())).toContain("PRIVATE_BROWSER_SIBLING");
    } finally {
        await controller.dispose();
        await web.dispose();
    }
});

test("an initial external redirect never publishes successful siblings before leaving the browser", async () => {
    const commit = vi.fn(() => deny(403, "Private"));
    const web = createWebRuntime({
        definition: defineWebApp({
            id: "external-redirect",
            pages: routePages(
                [
                    {
                        id: "secret",
                        handler: () => ({
                            id: "secret",
                            pageType: "secret",
                            title: "PRIVATE_REDIRECT_SIBLING",
                        }),
                    },
                    {
                        id: "redirect",
                        handler: () => ({
                            id: "redirect",
                            pageType: "redirect",
                            title: "redirect",
                        }),
                    },
                ],
                [],
            ),
            beforeLoad: [
                (ctx) =>
                    ctx.intent.id === "redirect" ? redirect("https://external.test/") : next(),
            ],
            beforeCommit: [commit],
            getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
        }),
    });
    const onRedirect = vi.fn(() => undefined);
    const session = createWebSession({
        web,
        isServer: false,
        onRedirect,
        initial: split([
            { id: "secret", content: leaf("secret") },
            { id: "redirect", content: leaf("redirect") },
        ]),
    });
    try {
        expect(JSON.stringify(await session.start())).not.toContain("PRIVATE_REDIRECT_SIBLING");
        expect(onRedirect).toHaveBeenCalledOnce();
        expect(commit).not.toHaveBeenCalled();
    } finally {
        await session.dispose();
        await web.dispose();
    }
});
test("transaction phases surround per-page Split loads exactly once and precede listeners", async () => {
    const order: string[] = [];
    const fixtureApp = fixture({
        beforeNavigate: [
            (ctx) => {
                expect(ctx.isServer).toBe(false);
                expect(ctx.signal).toBe(ctx.execution.signal);
                order.push("navigate");
                return next();
            },
        ],
        beforeCommit: [
            (ctx) => {
                expect(ctx.candidate.destinations).toHaveLength(2);
                order.push("commit");
                return next();
            },
        ],
        beforeLoad: [
            () => {
                order.push("before");
                return next();
            },
        ],
        afterLoad: [
            () => {
                order.push("after");
                return next();
            },
        ],
    });
    fixtureApp.controller.subscribe(() => order.push("listener"));
    await fixtureApp.controller.perform({
        kind: "hydrate",
        tree: split([
            { id: "a", content: leaf("home") },
            { id: "b", content: leaf("other") },
        ]),
    });
    expect(order).toEqual(["navigate", "before", "after", "before", "after", "commit", "listener"]);
    await fixtureApp.controller.dispose();
    await fixtureApp.web.dispose();
});
test.each(["beforeNavigate", "beforeCommit"] as const)(
    "%s veto preserves an empty exit, snapshot, listeners and retained cache",
    async (phase) => {
        let veto = false;
        const f = fixture({ [phase]: [() => (veto ? deny(409, "Unsaved draft") : next())] });
        await f.controller.perform({ kind: "hydrate", tree: f.controller.getTree() });
        const original = f.controller.getSnapshot();
        const listener = vi.fn();
        f.controller.subscribe(listener);
        veto = true;
        const rejected = await f.controller.perform({ kind: "hydrate", tree: stack([]) });
        expect(rejected).not.toBe(original);
        expect(rejected.rejection).toEqual({ kind: "deny", status: 409, message: "Unsaved draft" });
        expect(f.controller.getSnapshot()).toBe(original);
        expect(listener).not.toHaveBeenCalled();
        veto = false;
        await f.controller.perform({ kind: "hydrate", tree: f.controller.getTree() });
        expect(f.events).toEqual(["load:home"]);
        await f.controller.dispose();
        await f.web.dispose();
    },
);
test("beforeCommit veto does not admit loaded cache or evict refreshed committed data", async () => {
    let veto = false;
    const f = fixture({ beforeCommit: [() => (veto ? deny(409, "draft") : next())] });
    await f.controller.perform({ kind: "hydrate", tree: f.controller.getTree() });
    const original = f.controller.getSnapshot();
    veto = true;
    await f.controller.perform({ kind: "refresh" });
    expect(f.controller.getSnapshot()).toBe(original);
    veto = false;
    await f.controller.perform({ kind: "hydrate", tree: f.controller.getTree() });
    expect(f.events).toEqual(["load:home", "load:home"]);
    await f.controller.dispose();
    await f.web.dispose();
});
test.each(["beforeNavigate", "beforeCommit"] as const)(
    "async %s cancellation stops commit and keeps execution signal",
    async (phase) => {
        let entered!: () => void, release!: () => void;
        const gate = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        let hookSignal!: AbortSignal;
        const f = fixture({
            [phase]: [
                async (ctx: { signal: AbortSignal }) => {
                    hookSignal = ctx.signal;
                    entered();
                    await pending;
                    return next();
                },
            ],
        });
        const original = f.controller.getSnapshot();
        const result = f.controller.perform({ kind: "hydrate", tree: f.controller.getTree() });
        const assertion = expect(result).rejects.toMatchObject({ code: "cancelled" });
        await gate;
        f.controller.cancel();
        expect(hookSignal.aborted).toBe(true);
        release();
        await assertion;
        expect(f.controller.getSnapshot()).toBe(original);
        await f.controller.dispose();
        await f.web.dispose();
    },
);
test("admission redirect preserves transaction identity, final commit sees final candidate, invalid commit redirect rejects", async () => {
    let transitionId: string | undefined;
    const beforeNavigate = vi.fn((ctx) => {
        transitionId = ctx.transitionId;
        return redirect("/other");
    });
    const beforeCommit = vi.fn((ctx) => {
        expect(ctx.transitionId).toBe(transitionId);
        expect(ctx.candidate.destinations[0].intent).toBe("other");
        return next();
    });
    const f = fixture({ beforeNavigate: [beforeNavigate], beforeCommit: [beforeCommit] });
    const controller = createWebSession({
        web: f.web,
        initial: leaf("home"),
        onRedirect: () => leaf("other"),
    });
    await controller.perform({ kind: "hydrate", tree: controller.getTree() });
    expect(beforeNavigate).toHaveBeenCalledOnce();
    expect(beforeCommit).toHaveBeenCalledOnce();
    expect(f.events).toEqual(["load:other"]);
    const invalidFramework = createWebRuntime({
        definition: defineWebApp({
            ...f.web.definition!,
            beforeNavigate: [],
            beforeCommit: [],
        }),
    });
    const invalid = createWebSession({
        web: invalidFramework,
        initial: leaf("home"),
        beforeCommit: [(() => redirect("/")) as never],
    });
    await expect(
        invalid.perform({ kind: "hydrate", tree: invalid.getTree() }),
    ).rejects.toMatchObject({ code: "configuration" });
    await invalid.dispose();
    await invalidFramework.dispose();
    await controller.dispose();
    await f.controller.dispose();
    await f.web.dispose();
});
test("denied commit preserves one-shot SSR prefetch until a committed read", async () => {
    let veto = true;
    const f = fixture({ beforeCommit: [() => (veto ? deny(409, "draft") : next())] });
    const target = leaf("home");
    const prefetched = PrefetchedIntents.fromArray([
        {
            entryId: target.entryId,
            intent: { id: "home", params: {} },
            data: { id: "prefetch", pageType: "home", title: "prefetch" },
        },
    ]);
    const framework = createWebRuntime({
        definition: f.web.definition,
        prefetchedIntents: prefetched,
    });
    const controller = createWebSession({ web: framework, initial: target });
    await controller.perform({ kind: "hydrate", tree: controller.getTree() });
    expect(prefetched.size).toBe(1);
    veto = false;
    const committed = await controller.perform({ kind: "hydrate", tree: controller.getTree() });
    expect(committed.destinations[0].page.id).toBe("prefetch");
    expect(prefetched.size).toBe(0);
    await controller.dispose();
    await framework.dispose();
    await f.controller.dispose();
    await f.web.dispose();
});
