import { ACTION_KINDS } from "../../src/actions/types";
import { routePages } from "../helpers/definition";
import { fixtureEntryId } from "../helpers/navigation";
import { leaf, treeShape } from "../helpers/navigation";
import { describe, expect, test, vi } from "vite-plus/test";
import { Container } from "@finesoft/core";
import { createWebRuntime } from "../../src/application/runtime";
import { defineWebApp } from "../../src/application/definition";
import type { PageControllerDefinition } from "../../src/application/types";
import type { Intent } from "@finesoft/core";
import type { FixtureController } from "../helpers/definition";
import { deny, next, redirect, rewrite } from "../../src/middleware/types";
import type {
    AfterLoadGuard,
    BeforeLoadGuard,
    NavigationContext,
} from "../../src/middleware/types";
import type { BasePage } from "../../src/models/page";
import { PrefetchedIntents } from "../../src/prefetched-intents/prefetched-intents";
import { Router } from "../../src/router/router";
import { createWebSession, type WebSessionOptions } from "../../src/application/session";
import { split, stack, tabs } from "../../src/navigation/nodes";
import { SPLIT_VISIBILITIES, type NavigationNode } from "../../src/navigation/types";

test("one queued redirect chain disposes each execution before following and commits only the final native-ready snapshot", async () => {
    const events: string[] = [];
    const options = makeOptions({
        controllers: ["home", "login", "final"].map((id) => ({
            id,
            handler: (_params, context) => {
                events.push(`load:${id}`);
                context.onDispose(() => {
                    events.push(`dispose:${id}`);
                });
                return pageFor(id, {});
            },
        })),
        initial: stack([leaf("home")]),
        afterLoad: [
            (ctx) =>
                ctx.intent.id === "home"
                    ? redirect("/login")
                    : ctx.intent.id === "login"
                      ? redirect("/final")
                      : next(),
        ],
        onRedirect: async ({ url }, candidate) => {
            const previous = candidate.destinations[0].intent;
            expect(events.at(-1)).toBe(`dispose:${previous}`);
            events.push(`follow:${url}`);
            return stack([leaf(url.slice(1))]);
        },
        viewReady: async (snapshot) => {
            await Promise.resolve();
            events.push(`ready:${snapshot.destinations[0].intent}`);
        },
    });
    const controller = createWebSession(options);
    const commits = vi.fn();
    controller.subscribe(commits);
    try {
        const snapshot = await controller.perform({ kind: "replaceTop", intent: "home" });
        expect(snapshot.historyMode).toBe("replace");
        expect(commits).toHaveBeenCalledOnce();
        expect(events).toEqual([
            "load:home",
            "dispose:home",
            "follow:/login",
            "load:login",
            "dispose:login",
            "follow:/final",
            "load:final",
            "ready:final",
            "dispose:final",
        ]);
    } finally {
        await controller.dispose();
        await options.web.dispose();
    }
});

// =====================================================================
// 测试替身（仅存在于测试文件，源码无 mock）
// =====================================================================

/** 一个简单的页面工厂——把 intent + params 编进 page，方便断言「确实 dispatch 了它」。 */
function pageFor(intent: string, params: Record<string, unknown>): BasePage {
    return {
        id: intent,
        pageType: intent,
        title: `${intent}:${JSON.stringify(params)}`,
    };
}

/** 注册若干 intentId → page 工厂的 controller；记录每次 dispatch 的调用。 */
function makeControllers(
    handlers: Record<string, (params: Record<string, unknown>) => BasePage>,
    calls?: string[],
): PageControllerDefinition[] {
    const dispatcher = [] as PageControllerDefinition[];
    for (const intentId of Object.keys(handlers)) {
        const controller: FixtureController = {
            intentId,
            perform(intent: Intent): BasePage {
                calls?.push(intentId);
                return handlers[intentId](intent.params ?? {});
            },
        };
        dispatcher.push(factory(controller));
    }
    return dispatcher;
}

/** 一个抛错的 controller（验证 dispatch 失败的兜底语义）。 */
function makeThrowingControllers(intentId: string, calls?: string[]): PageControllerDefinition[] {
    const dispatcher = [] as PageControllerDefinition[];
    dispatcher.push(
        factory({
            intentId,
            perform(): BasePage {
                calls?.push(intentId);
                throw new Error(`boom:${intentId}`);
            },
        }),
    );
    return dispatcher;
}

/** 默认选项装配器：只需给 dispatcher + initial，其余取默认。 */
function factory(controller: FixtureController): PageControllerDefinition {
    return {
        id: controller.intentId,
        handler: (params, context) =>
            controller.perform({ id: controller.intentId, params }, context.container, context),
    };
}
function makeOptions(
    overrides: Partial<WebSessionOptions> & {
        controllers: PageControllerDefinition[];
        initial: NavigationNode;
        router?: Router;
        prefetched?: PrefetchedIntents;
    },
): WebSessionOptions {
    const { controllers, router, prefetched, ...options } = overrides;
    const framework = createWebRuntime({
        definition: defineWebApp({
            pages: routePages(
                controllers,
                (router?.getDefinitions() ?? []).map((route) => ({
                    path: route.pattern,
                    intentId: route.intentId,
                })),
            ),
            id: "navigation-fixture",
            getErrorPage: (status, message) => ({
                id: String(status),
                pageType: "error",
                title: message,
            }),
        }),
        prefetchedIntents: prefetched,
    });
    return { ...options, web: framework };
}

// =====================================================================
// 单 LeafNode 表示扁平单页
// =====================================================================

describe("single leaf flat page", () => {
    test("resolve() dispatches the one intent and yields one destination", async () => {
        const calls: string[] = [];
        const dispatcher = makeControllers({ home: (p) => pageFor("home", p) }, calls);
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: leaf("home", { a: 1 }) }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });

        expect(calls).toEqual(["home"]);
        expect(snap.destinations).toHaveLength(1);
        expect(snap.destinations[0].intent).toBe("home");
        expect(snap.destinations[0].params).toEqual({ a: 1 });
        expect(snap.destinations[0].page.pageType).toBe("home");
        expect(snap.destinations[0].status).toBeUndefined();
        expect(snap.tree).toMatchObject(treeShape(leaf("home", { a: 1 })));
    });

    test("getTree / getSnapshot reflect committed state", async () => {
        const dispatcher = makeControllers({ home: (p) => pageFor("home", p) });
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: leaf("home") }),
        );

        // 解析前：tree = initial，destinations 空
        expect(controller.getTree()).toMatchObject(treeShape(leaf("home")));
        expect(controller.getSnapshot().destinations).toEqual([]);

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        expect(controller.getSnapshot()).toBe(snap);
        expect(controller.getTree()).toBe(snap.tree);
    });
});

// =====================================================================
// 栈操作：push / pop / popToRoot / replaceTop（便捷方法 + apply）
// =====================================================================

describe("stack operations", () => {
    function stackController(calls: string[]): ReturnType<typeof createWebSession> {
        const dispatcher = makeControllers(
            {
                root: (p) => pageFor("root", p),
                detail: (p) => pageFor("detail", p),
                edit: (p) => pageFor("edit", p),
            },
            calls,
        );
        return createWebSession(
            makeOptions({ controllers: dispatcher, initial: stack(leaf("root")) }),
        );
    }

    test("push appends a new leaf on the active stack and dispatches it", async () => {
        const calls: string[] = [];
        const controller = stackController(calls);
        await controller.perform({ kind: "hydrate", tree: controller.getTree() }); // ["root"]

        const snap = await controller.perform({
            kind: "push",
            intent: "detail",
            params: { id: 7 },
        });

        expect(calls).toEqual(["root", "detail"]);
        // 栈顶 detail 是唯一可见目标
        expect(snap.destinations).toHaveLength(1);
        expect(snap.destinations[0].intent).toBe("detail");
        expect(snap.destinations[0].params).toEqual({ id: 7 });
        // 树结构：root + detail
        expect(snap.tree).toMatchObject(
            treeShape(stack([leaf("root"), leaf("detail", { id: 7 })])),
        );
    });

    test("pop reveals the still-present root from cache without re-dispatching", async () => {
        const calls: string[] = [];
        const controller = stackController(calls);
        await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        await controller.perform({ kind: "push", intent: "detail" });

        const snap = await controller.perform({ kind: "pop" });

        // root 自始至终在树中（stack 底）→ 首屏已 dispatch 并缓存 → pop 复用、不重 fetch。
        expect(calls).toEqual(["root", "detail"]);
        expect(snap.destinations).toHaveLength(1);
        expect(snap.destinations[0].intent).toBe("root");
        expect(snap.tree).toMatchObject(treeShape(stack([leaf("root")])));
    });

    test("a destination unchanged FROM THE PREVIOUS snapshot is reused (split column)", async () => {
        const calls: string[] = [];
        const dispatcher = makeControllers(
            { list: (p) => pageFor("list", p), detail: (p) => pageFor("detail", p) },
            calls,
        );
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: split([{ id: "list", content: leaf("list") }, { id: "detail" }]),
            }),
        );
        await controller.perform({ kind: "hydrate", tree: controller.getTree() }); // list dispatched

        // 设置 detail 列：list 列在上一快照里未变 → 复用，仅 detail 新 dispatch
        await controller.perform({ kind: "selectColumn", columnId: "detail", intent: "detail" });
        expect(calls).toEqual(["list", "detail"]);
    });

    test("pop never drops below root entry", async () => {
        const calls: string[] = [];
        const controller = stackController(calls);
        await controller.perform({ kind: "hydrate", tree: controller.getTree() });

        const snap = await controller.perform({ kind: "pop", count: 5 });

        expect(snap.tree).toMatchObject(treeShape(stack([leaf("root")])));
        expect(snap.destinations[0].intent).toBe("root");
    });

    test("replaceTop swaps the top entry", async () => {
        const calls: string[] = [];
        const controller = stackController(calls);
        await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        await controller.perform({ kind: "push", intent: "detail" });

        const snap = await controller.perform({
            kind: "replaceTop",
            intent: "edit",
            params: { id: 1 },
        });

        expect(snap.tree).toMatchObject(treeShape(stack([leaf("root"), leaf("edit", { id: 1 })])));
        expect(snap.destinations[0].intent).toBe("edit");
        expect(calls).toEqual(["root", "detail", "edit"]);
    });

    test("popToRoot via generic apply", async () => {
        const calls: string[] = [];
        const controller = stackController(calls);
        await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        await controller.perform({ kind: "push", intent: "detail" });
        await controller.perform({ kind: "push", intent: "edit" });

        const snap = await controller.perform({ kind: ACTION_KINDS.POP_TO_ROOT });

        expect(snap.tree).toMatchObject(treeShape(stack([leaf("root")])));
        expect(snap.destinations[0].intent).toBe("root");
    });

    test("popTo via generic apply keeps [0..index]", async () => {
        const calls: string[] = [];
        const dispatcher = makeControllers(
            { a: (p) => pageFor("a", p), b: (p) => pageFor("b", p), c: (p) => pageFor("c", p) },
            calls,
        );
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: stack([leaf("a"), leaf("b"), leaf("c")]),
            }),
        );
        await controller.perform({ kind: "hydrate", tree: controller.getTree() }); // only top "c" is visible → ["c"]

        const snap = await controller.perform({ kind: ACTION_KINDS.POP_TO, index: 0 });

        expect(snap.tree).toMatchObject(treeShape(stack([leaf("a")])));
        expect(snap.destinations[0].intent).toBe("a");
        expect(calls).toEqual(["c", "a"]);
    });

    test("revealing a cached entry re-runs guards but does NOT re-dispatch", async () => {
        const dispatchCalls: string[] = [];
        const guardCalls: string[] = [];
        const guard: BeforeLoadGuard = (ctx: NavigationContext) => {
            guardCalls.push(ctx.intent.id);
            return next();
        };
        const dispatcher = makeControllers(
            { root: (p) => pageFor("root", p), detail: (p) => pageFor("detail", p) },
            dispatchCalls,
        );
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: stack(leaf("root")),
                beforeLoad: [guard],
            }),
        );
        await controller.perform({ kind: "hydrate", tree: controller.getTree() }); // dispatch root；guard[root]
        await controller.perform({ kind: "push", intent: "detail" }); // dispatch detail；guard[detail]
        dispatchCalls.length = 0;
        guardCalls.length = 0;

        await controller.perform({ kind: "pop" }); // 揭示 root

        expect(guardCalls).toEqual(["root"]); // 守卫照常跑（安全语义不变）
        expect(dispatchCalls).toEqual([]); // 但不重 fetch（复用缓存页）
    });

    test("an entry removed from the tree then re-added is re-dispatched (cache pruned on leave)", async () => {
        const calls: string[] = [];
        const dispatcher = makeControllers(
            { home: (p) => pageFor("home", p), other: (p) => pageFor("other", p) },
            calls,
        );
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: stack(leaf("home")) }),
        );
        await controller.perform({ kind: "hydrate", tree: controller.getTree() }); // [home]
        await controller.perform({ kind: "replaceTop", intent: "other" }); // home 离树 → 缓存 prune；[other]
        await controller.perform({ kind: "replaceTop", intent: "home" }); // home 重新入树、未缓存 → 重新 dispatch

        expect(calls).toEqual(["home", "other", "home"]);
    });
});

// =====================================================================
// Tabs：多分支只解析激活分支；切换 tab 复用页
// =====================================================================

describe("tabs", () => {
    test("only the active branch is visible + dispatched", async () => {
        const calls: string[] = [];
        const dispatcher = makeControllers(
            { home: (p) => pageFor("home", p), profile: (p) => pageFor("profile", p) },
            calls,
        );
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: tabs({
                    active: "home",
                    branches: { home: leaf("home"), profile: leaf("profile") },
                }),
            }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });

        expect(calls).toEqual(["home"]);
        expect(snap.destinations).toHaveLength(1);
        expect(snap.destinations[0].intent).toBe("home");
    });

    test("selectTab switches active branch and dispatches the new one", async () => {
        const calls: string[] = [];
        const dispatcher = makeControllers(
            { home: (p) => pageFor("home", p), profile: (p) => pageFor("profile", p) },
            calls,
        );
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: tabs({
                    active: "home",
                    branches: { home: leaf("home"), profile: leaf("profile") },
                }),
            }),
        );
        await controller.perform({ kind: "hydrate", tree: controller.getTree() });

        const snap = await controller.perform({ kind: "selectTab", key: "profile" });

        expect(calls).toEqual(["home", "profile"]);
        expect(snap.destinations[0].intent).toBe("profile");

        // 切回 home：home 分支自始至终在 tabs 树中 → 缓存复用、不重 dispatch。
        const back = await controller.perform({ kind: "selectTab", key: "home" });
        expect(calls).toEqual(["home", "profile"]);
        expect(back.destinations[0].intent).toBe("home");
    });
});

// =====================================================================
// Split：所有非空列都可见；secondary 列也被 dispatch（无守卫）
// =====================================================================

describe("split", () => {
    test("all non-empty columns are visible and ordered like collectVisibleDestinations", async () => {
        const calls: string[] = [];
        const dispatcher = makeControllers(
            { list: (p) => pageFor("list", p), detail: (p) => pageFor("detail", p) },
            calls,
        );
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: split([
                    { id: "list", content: leaf("list") },
                    { id: "detail", content: leaf("detail") },
                ]),
            }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });

        expect(snap.destinations.map((d) => d.intent)).toEqual(["list", "detail"]);
        // dispatch 顺序 = 可见顺序
        expect(calls).toEqual(["list", "detail"]);
    });

    test("selectColumn sets a column's content and clears columns after it", async () => {
        const calls: string[] = [];
        const dispatcher = makeControllers(
            {
                list: (p) => pageFor("list", p),
                detail: (p) => pageFor("detail", p),
                more: (p) => pageFor("more", p),
            },
            calls,
        );
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: split([{ id: "list", content: leaf("list") }, { id: "detail" }]),
            }),
        );
        await controller.perform({ kind: "hydrate", tree: controller.getTree() }); // ["list"]

        const snap = await controller.perform({
            kind: "selectColumn",
            columnId: "detail",
            intent: "detail",
            params: { id: 9 },
        });

        expect(snap.destinations.map((d) => d.intent)).toEqual(["list", "detail"]);
        // list 复用首屏，仅 detail 新 dispatch
        expect(calls).toEqual(["list", "detail"]);
        expect(snap.tree).toMatchObject(
            treeShape(
                split([
                    { id: "list", content: leaf("list") },
                    { id: "detail", content: leaf("detail", { id: 9 }) },
                ]),
            ),
        );
    });

    test("selectColumn with undefined intent clears the column", async () => {
        const dispatcher = makeControllers({
            list: (p) => pageFor("list", p),
            detail: (p) => pageFor("detail", p),
        });
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: split([
                    { id: "list", content: leaf("list") },
                    { id: "detail", content: leaf("detail") },
                ]),
            }),
        );
        await controller.perform({ kind: "hydrate", tree: controller.getTree() });

        const snap = await controller.perform({
            kind: "selectColumn",
            columnId: "detail",
            intent: undefined,
        });

        expect(snap.destinations.map((d) => d.intent)).toEqual(["list"]);
        expect(snap.tree).toMatchObject(
            treeShape(split([{ id: "list", content: leaf("list") }, { id: "detail" }])),
        );
    });
});

// =====================================================================
// 守卫：beforeLoad next/deny/redirect/rewrite
// =====================================================================

describe("beforeLoad guards (primary destination)", () => {
    test("next → dispatch proceeds normally", async () => {
        const calls: string[] = [];
        const guard: BeforeLoadGuard = () => next();
        const dispatcher = makeControllers({ home: (p) => pageFor("home", p) }, calls);
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: leaf("home"),
                beforeLoad: [guard],
            }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        expect(calls).toEqual(["home"]);
        expect(snap.destinations[0].status).toBeUndefined();
    });

    test("deny → status set, intent NOT dispatched, error page used", async () => {
        const calls: string[] = [];
        const guard: BeforeLoadGuard = () => deny(403, "nope");
        const dispatcher = makeControllers({ secret: (p) => pageFor("secret", p) }, calls);
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: leaf("secret"),
                beforeLoad: [guard],
            }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });

        expect(calls).toEqual([]); // 未 dispatch
        expect(snap.destinations).toHaveLength(1);
        expect(snap.destinations[0].status).toBe(403);
        expect(snap.destinations[0].page.pageType).toBe("error");
    });

    test("deny uses custom getErrorPage", async () => {
        const guard: BeforeLoadGuard = () => deny(401, "login");
        const dispatcher = makeControllers({ secret: (p) => pageFor("secret", p) });
        const getErrorPage = vi.fn(
            (status: number, message: string): BasePage => ({
                id: "custom-error",
                pageType: "custom-error",
                title: `${status}/${message}`,
            }),
        );
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: leaf("secret"),
                beforeLoad: [guard],
                getErrorPage,
            }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        expect(getErrorPage).toHaveBeenCalledWith(401, "login");
        expect(snap.destinations[0].page.pageType).toBe("custom-error");
    });

    test("redirect → onRedirect called, intent NOT dispatched", async () => {
        const calls: string[] = [];
        const onRedirect = vi.fn();
        const guard: BeforeLoadGuard = () => redirect("/login", 302);
        const dispatcher = makeControllers({ secret: (p) => pageFor("secret", p) }, calls);
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: leaf("secret"),
                beforeLoad: [guard],
                onRedirect,
            }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });

        expect(onRedirect).toHaveBeenCalledWith({ url: "/login", status: 302 }, snap);
        expect(calls).toEqual([]);
        expect(snap.destinations[0].status).toBe(302);
    });

    test("rewrite → re-route to new URL, swap intent/params for the primary destination", async () => {
        const calls: string[] = [];
        const router = new Router();
        router.add("/canonical/:id", "canonical");
        const guard: BeforeLoadGuard = (ctx) =>
            ctx.intent.id === "alias" ? rewrite("/canonical/42") : next();
        const dispatcher = makeControllers(
            { alias: (p) => pageFor("alias", p), canonical: (p) => pageFor("canonical", p) },
            calls,
        );
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                router,
                initial: leaf("alias"),
                beforeLoad: [guard],
            }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });

        // alias 没 dispatch；canonical 被 dispatch
        expect(calls).toEqual(["canonical"]);
        expect(snap.destinations[0].intent).toBe("canonical");
        expect(snap.destinations[0].params).toEqual({ id: "42" });
    });

    test("rewrite to an unroutable URL refuses the destination", async () => {
        const calls: string[] = [];
        const router = new Router(); // 无路由 → resolve 返回 null
        const guard: BeforeLoadGuard = () => rewrite("/nope");
        const dispatcher = makeControllers({ alias: (p) => pageFor("alias", p) }, calls);
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                router,
                initial: leaf("alias"),
                beforeLoad: [guard],
            }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        // A failed rewrite must not load the original destination.
        expect(calls).toEqual([]);
        expect(snap.destinations[0].status).toBe(404);
        expect(snap.destinations[0].intent).toBe("alias");
    });
});

// =====================================================================
// 守卫：afterLoad next/deny/redirect/rewrite
// =====================================================================

describe("afterLoad guards (primary destination)", () => {
    test("afterLoad runs with the dispatched page in context", async () => {
        const seen: BasePage[] = [];
        const guard: AfterLoadGuard = (ctx) => {
            seen.push(ctx.page);
            return next();
        };
        const dispatcher = makeControllers({ home: (p) => pageFor("home", p) });
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: leaf("home"),
                afterLoad: [guard],
            }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        expect(seen).toHaveLength(1);
        expect(seen[0].pageType).toBe("home");
        expect(snap.destinations[0].status).toBeUndefined();
    });

    test("afterLoad deny returns an error destination without committing the loaded page", async () => {
        const guard: AfterLoadGuard = () => deny(403, "blocked");
        const dispatcher = makeControllers({ home: (p) => pageFor("home", p) });
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: leaf("home"),
                afterLoad: [guard],
            }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        expect(snap.destinations[0].status).toBe(403);
        // 与现有 runner 一致：afterLoad deny 保留已加载页
        expect(snap.destinations[0].page.pageType).toBe("error");
    });

    test("afterLoad redirect invokes the callback without exposing the loaded page", async () => {
        const onRedirect = vi.fn();
        const guard: AfterLoadGuard = () => redirect("/elsewhere", 302);
        const dispatcher = makeControllers({ home: (p) => pageFor("home", p) });
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: leaf("home"),
                afterLoad: [guard],
                onRedirect,
            }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        expect(onRedirect).toHaveBeenCalledWith(
            { url: "/elsewhere", status: 302 },
            expect.anything(),
        );
        expect(snap.destinations[0].page.pageType).toBe("error");
        expect(snap.destinations[0].status).toBe(302);
    });

    test("afterLoad rewrite → page kept, NO status (canonical URL only)", async () => {
        const guard: AfterLoadGuard = () => rewrite("/canonical");
        const dispatcher = makeControllers({ home: (p) => pageFor("home", p) });
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: leaf("home"),
                afterLoad: [guard],
            }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        expect(snap.destinations[0].page.pageType).toBe("home");
        expect(snap.destinations[0].status).toBeUndefined();
    });

    test("guards run for every visible split column", async () => {
        const guardCalls: string[] = [];
        const guard: BeforeLoadGuard = (ctx: NavigationContext) => {
            guardCalls.push(ctx.intent.id);
            return next();
        };
        const dispatcher = makeControllers({
            list: (p) => pageFor("list", p),
            detail: (p) => pageFor("detail", p),
        });
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: split([
                    { id: "list", content: leaf("list") },
                    { id: "detail", content: leaf("detail") },
                ]),
                beforeLoad: [guard],
            }),
        );

        await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        // 激活路径末端 = 最后一个非空列 detail → 仅它跑守卫
        expect(guardCalls).toEqual(["list", "detail"]);
    });
});

// =====================================================================
// dispatch 失败：兜底页 + status=500，不抛出 apply
// =====================================================================

describe("dispatch failure handling", () => {
    test("a throwing controller does not throw out of resolve; surfaces status 500 + error page", async () => {
        const calls: string[] = [];
        const dispatcher = makeThrowingControllers("home", calls);
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: leaf("home") }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });

        expect(calls).toEqual(["home"]);
        expect(snap.destinations).toHaveLength(1);
        expect(snap.destinations[0].status).toBe(500);
        expect(snap.destinations[0].page.pageType).toBe("error");
    });

    test("a failing secondary column does not sink the whole snapshot", async () => {
        const dispatcher = [] as PageControllerDefinition[];
        dispatcher.push(
            factory({
                intentId: "ok",
                perform: (i: Intent): BasePage => pageFor("ok", i.params ?? {}),
            }),
        );
        dispatcher.push(
            factory({
                intentId: "bad",
                perform(): BasePage {
                    throw new Error("bad column");
                },
            }),
        );
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: split([
                    { id: "a", content: leaf("ok") },
                    { id: "b", content: leaf("bad") },
                ]),
            }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        expect(snap.destinations.map((d) => d.intent)).toEqual(["ok", "bad"]);
        expect(snap.destinations[0].status).toBeUndefined();
        expect(snap.destinations[1].status).toBe(500);
    });

    test("unregistered intent (no controller) is treated as a dispatch failure", async () => {
        const dispatcher = [] as PageControllerDefinition[]; // 空：home 无 controller
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: leaf("home") }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        expect(snap.destinations[0].status).toBe(404);
        expect(snap.destinations[0].page.pageType).toBe("error");
    });
});

// =====================================================================
// 预取缓存复用（SSR → CSR hydration）
// =====================================================================

describe("prefetched reuse", () => {
    test("primary destination reuses a prefetched page without dispatching", async () => {
        const calls: string[] = [];
        const dispatcher = makeControllers({ home: (p) => pageFor("home", p) }, calls);
        const prefetchedPage: BasePage = { id: "ssr-home", pageType: "home", title: "from-ssr" };
        const prefetched = PrefetchedIntents.fromArray([
            {
                entryId: fixtureEntryId("home", {}),
                intent: { id: "home", params: {} },
                data: prefetchedPage,
            },
        ]);
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: leaf("home"), prefetched }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });

        expect(calls).toEqual([]); // 命中预取缓存，未走 controller
        expect(snap.destinations[0].page.title).toBe("from-ssr");
    });

    test("secondary destination also reuses prefetched results", async () => {
        const calls: string[] = [];
        const dispatcher = makeControllers(
            { list: (p) => pageFor("list", p), detail: (p) => pageFor("detail", p) },
            calls,
        );
        const prefetched = PrefetchedIntents.fromArray([
            {
                entryId: fixtureEntryId("list", {}),
                intent: { id: "list", params: {} },
                data: { id: "x", pageType: "list", title: "L" },
            },
            {
                entryId: fixtureEntryId("detail", {}),
                intent: { id: "detail", params: {} },
                data: { id: "y", pageType: "detail", title: "D" },
            },
        ]);
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: split([
                    { id: "list", content: leaf("list") },
                    { id: "detail", content: leaf("detail") },
                ]),
                prefetched,
            }),
        );

        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        expect(calls).toEqual([]);
        expect(snap.destinations.map((d) => d.page.title)).toEqual(["L", "D"]);
    });

    test("a popped-back present entry reuses its cached page (prefetched result included), no re-dispatch", async () => {
        const calls: string[] = [];
        const dispatcher = makeControllers(
            { home: (p) => pageFor("home", p), other: (p) => pageFor("other", p) },
            calls,
        );
        const prefetched = PrefetchedIntents.fromArray([
            {
                entryId: fixtureEntryId("home", {}),
                intent: { id: "home", params: {} },
                data: { id: "h", pageType: "home", title: "S" },
            },
        ]);
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: stack(leaf("home")),
                prefetched,
            }),
        );

        await controller.perform({ kind: "hydrate", tree: controller.getTree() }); // home 来自预取（消费 + 缓存），calls=[]
        await controller.perform({ kind: "push", intent: "other" }); // calls=[other]；home 仍在树（栈底）
        const snap = await controller.perform({ kind: "pop" }); // 揭示 home：复用缓存、不重 dispatch

        expect(calls).toEqual(["other"]);
        expect(snap.destinations[0].intent).toBe("home");
        expect(snap.destinations[0].page.title).toBe("S"); // 复用的是 SSR 预取页
    });
});

// =====================================================================
// hydrate：用外部树替换并重解析
// =====================================================================

describe("hydrate", () => {
    test("replaces the tree and re-resolves its visible destinations", async () => {
        const calls: string[] = [];
        const dispatcher = makeControllers(
            { home: (p) => pageFor("home", p), detail: (p) => pageFor("detail", p) },
            calls,
        );
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: leaf("home") }),
        );
        await controller.perform({ kind: "hydrate", tree: controller.getTree() });

        const incoming: NavigationNode = stack([leaf("home"), leaf("detail", { id: 3 })]);
        const snap = await controller.perform({ kind: "hydrate", tree: incoming });

        expect(snap.tree).toMatchObject(incoming);
        expect(snap.destinations[0].intent).toBe("detail");
        // home 复用首屏，detail 新 dispatch
        expect(calls).toEqual(["home", "detail"]);
    });
});

// =====================================================================
// 订阅 / 通知
// =====================================================================

describe("subscribe", () => {
    test("listeners are notified on every commit with the new snapshot", async () => {
        const dispatcher = makeControllers({
            home: (p) => pageFor("home", p),
            detail: (p) => pageFor("detail", p),
        });
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: stack(leaf("home")) }),
        );
        const received: string[][] = [];
        const unsubscribe = controller.subscribe((snap) => {
            received.push(snap.destinations.map((d) => d.intent));
        });

        await controller.perform({ kind: "hydrate", tree: controller.getTree() }); // [home]
        await controller.perform({ kind: "push", intent: "detail" }); // [detail]

        expect(received).toEqual([["home"], ["detail"]]);

        unsubscribe();
        await controller.perform({ kind: "pop" }); // listener removed → no new entry
        expect(received).toHaveLength(2);
    });

    test("the snapshot passed to listeners equals getSnapshot()", async () => {
        const dispatcher = makeControllers({ home: (p) => pageFor("home", p) });
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: leaf("home") }),
        );
        let last: unknown;
        controller.subscribe((snap) => {
            last = snap;
        });
        const snap = await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        expect(last).toBe(snap);
        expect(last).toBe(controller.getSnapshot());
    });
});

// =====================================================================
// 不可变 / 结构共享：操作不改输入树
// =====================================================================

describe("immutability", () => {
    test("push does not mutate the previous committed tree", async () => {
        const dispatcher = makeControllers({
            root: (p) => pageFor("root", p),
            detail: (p) => pageFor("detail", p),
        });
        const initial = stack(leaf("root"));
        const controller = createWebSession(makeOptions({ controllers: dispatcher, initial }));
        await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        const before = controller.getTree();

        await controller.perform({ kind: "push", intent: "detail" });

        // 原 committed 树未被改动（结构共享，新树是新引用）
        expect(before).toMatchObject(treeShape(stack([leaf("root")])));
        expect(controller.getTree()).not.toBe(before);
    });
});

// =====================================================================
// 无效操作：来自 operations 的 NavigationError 透传出 apply
// =====================================================================

describe("invalid operations propagate NavigationError", () => {
    test("selectTab on a non-tabs tree throws", async () => {
        const dispatcher = makeControllers({ home: (p) => pageFor("home", p) });
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: leaf("home") }),
        );
        await controller.perform({ kind: "hydrate", tree: controller.getTree() });

        await expect(controller.perform({ kind: "selectTab", key: "whatever" })).rejects.toThrow(
            /没有 tabs/,
        );
    });

    test("push with no stack on the active path throws", async () => {
        const dispatcher = makeControllers({ home: (p) => pageFor("home", p) });
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: leaf("home") }),
        );
        await controller.perform({ kind: "hydrate", tree: controller.getTree() });

        await expect(controller.perform({ kind: "push", intent: "x" })).rejects.toThrow(
            /没有可用的 stack/,
        );
    });
});

// =====================================================================
// 并发串行化：apply/resolve 排队，杜绝 last-write-wins 竞态
// =====================================================================

/**
 * 一个 dispatch 故意「慢」的 dispatcher：每次 perform 返回一个在下一个宏任务才 resolve
 * 的 promise，使 resolveTree 真正异步。这样并发的两次 apply 若不串行化，就会都读到同一棵
 * 原始树、各自解析、后提交者覆盖先提交者——正是被修复的竞态。
 */
function makeSlowDispatcher(
    intentIds: readonly string[],
    calls?: string[],
): PageControllerDefinition[] {
    const dispatcher = [] as PageControllerDefinition[];
    for (const intentId of intentIds) {
        dispatcher.push(
            factory({
                intentId,
                perform(intent: Intent): Promise<BasePage> {
                    calls?.push(intentId);
                    return new Promise((resolve) => {
                        // setTimeout(0)：把 resolve 推到宏任务，确保 apply 之间有真实的异步窗口。
                        setTimeout(() => resolve(pageFor(intentId, intent.params ?? {})), 0);
                    });
                },
            }),
        );
    }
    return dispatcher;
}

describe("concurrent apply() serialization (no last-write-wins race)", () => {
    test("two concurrent pushes both land; neither is dropped", async () => {
        const calls: string[] = [];
        const dispatcher = makeSlowDispatcher(["root", "a", "b"], calls);
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: stack(leaf("root")) }),
        );
        await controller.perform({ kind: "hydrate", tree: controller.getTree() }); // stack([root])

        // 不 await 第一次：两次 push 同步并发触发。
        const p1 = controller.perform({ kind: "push", intent: "a" });
        const p2 = controller.perform({ kind: "push", intent: "b" });
        const [snap1, snap2] = await Promise.all([p1, p2]);

        // 串行化后：第一次提交 stack([root, a])，第二次在其之上提交 stack([root, a, b])。
        expect(snap1.tree).toMatchObject(treeShape(stack([leaf("root"), leaf("a")])));
        expect(snap2.tree).toMatchObject(treeShape(stack([leaf("root"), leaf("a"), leaf("b")])));
        // 最终已提交树两者都在，没有谁被丢。
        expect(controller.getTree()).toMatchObject(
            treeShape(stack([leaf("root"), leaf("a"), leaf("b")])),
        );
    });

    test("many interleaved concurrent pushes apply in submission order", async () => {
        const dispatcher = makeSlowDispatcher(["root", "x0", "x1", "x2", "x3", "x4"]);
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: stack(leaf("root")) }),
        );
        await controller.perform({ kind: "hydrate", tree: controller.getTree() });

        const pending = [0, 1, 2, 3, 4].map((i) =>
            controller.perform({ kind: "push", intent: `x${i}` }),
        );
        await Promise.all(pending);

        // 全部按提交顺序叠加，无丢失、无错序。
        expect(controller.getTree()).toMatchObject(
            treeShape(
                stack([leaf("root"), leaf("x0"), leaf("x1"), leaf("x2"), leaf("x3"), leaf("x4")]),
            ),
        );
    });

    test("a rejected op does not poison the queue; later ops still commit", async () => {
        const calls: string[] = [];
        const dispatcher = makeSlowDispatcher(["root", "ok"], calls);
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: stack(leaf("root")) }),
        );
        await controller.perform({ kind: "hydrate", tree: controller.getTree() });

        // 第一次操作非法（对 stack 顶 leaf selectTab）→ reject；紧接着的合法 push 必须仍然成功。
        const bad = controller.perform({ kind: "selectTab", key: "nope" });
        const good = controller.perform({ kind: "push", intent: "ok" });

        await expect(bad).rejects.toThrow(/没有 tabs/);
        const snap = await good;
        expect(snap.tree).toMatchObject(treeShape(stack([leaf("root"), leaf("ok")])));
        expect(controller.getTree()).toMatchObject(treeShape(stack([leaf("root"), leaf("ok")])));
    });

    test("concurrent resolve() and apply() do not clobber each other", async () => {
        const dispatcher = makeSlowDispatcher(["root", "next"]);
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: stack(leaf("root")) }),
        );

        // 首屏 resolve 与一次 push 并发：串行队列保证 push 基于 resolve 后的树。
        const r = controller.perform({ kind: "hydrate", tree: controller.getTree() });
        const p = controller.perform({ kind: "push", intent: "next" });
        await Promise.all([r, p]);

        expect(controller.getTree()).toMatchObject(treeShape(stack([leaf("root"), leaf("next")])));
    });
});

// =====================================================================
// minimalContext.isServer：缺省 navigation 时填正确的环境标志
// =====================================================================

describe("minimalContext isServer (no navigation supplied)", () => {
    /** 一个守卫，把它看到的 ctx.isServer 记录下来。 */
    function recordingGuard(seen: boolean[]): BeforeLoadGuard {
        return (ctx: NavigationContext) => {
            seen.push(ctx.isServer);
            return next();
        };
    }

    test("defaults to true under a server-like env (no window)", async () => {
        const seen: boolean[] = [];
        const dispatcher = makeControllers({ home: (p) => pageFor("home", p) });
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: leaf("home"),
                beforeLoad: [recordingGuard(seen)],
                // 未配置 createContext 时使用默认守卫上下文。
            }),
        );

        await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        // Node 测试环境无 window → isServer 推断为 true。
        expect(seen).toEqual([true]);
    });

    test("explicit isServer:false overrides the env default in the fallback context", async () => {
        const seen: boolean[] = [];
        const dispatcher = makeControllers({ home: (p) => pageFor("home", p) });
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: leaf("home"),
                beforeLoad: [recordingGuard(seen)],
                isServer: false,
            }),
        );

        await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        // 显式 isServer:false → 兜底上下文报告浏览器侧，守卫据此走客户端分支。
        expect(seen).toEqual([false]);
    });

    test("explicit isServer:true is honored too", async () => {
        const seen: boolean[] = [];
        const dispatcher = makeControllers({ home: (p) => pageFor("home", p) });
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: leaf("home"),
                beforeLoad: [recordingGuard(seen)],
                isServer: true,
            }),
        );

        await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        expect(seen).toEqual([true]);
    });

    test("a supplied navigation context wins over the isServer option", async () => {
        const seen: boolean[] = [];
        const container = new Container();
        const dispatcher = makeControllers({ home: (p) => pageFor("home", p) });
        const controller = createWebSession(
            makeOptions({
                router: new Router(),
                controllers: dispatcher,
                initial: leaf("home"),
                beforeLoad: [recordingGuard(seen)],
                // isServer 选项说 true，但 createContext 提供了 isServer:false 的完整 navigation。
                isServer: true,
                createContext: ({ intent, params }): NavigationContext => ({
                    query: {},
                    url: "/home",
                    path: "/home",
                    params,
                    intent: { id: intent, params },
                    isServer: false,
                    container,
                    getCookie: () => undefined,
                    getHeader: () => undefined,
                }),
            }),
        );

        await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        // 应用提供的 navigation 优先：minimalContext 不生效。
        expect(seen).toEqual([false]);
    });
});

// =====================================================================
// setVisibility：可见性裁剪可见集 → 影响 SSR 预取 / 派发
// =====================================================================

describe("setVisibility 影响可见集与派发", () => {
    const threeColumns = (): NavigationNode =>
        split([
            { id: "sidebar", content: leaf("folders") },
            { id: "content", content: leaf("list") },
            { id: "detail", content: leaf("message") },
        ]);

    test("切 detailOnly：快照只剩 detail 目标，已解析的 message 复用不重派发", async () => {
        const calls: string[] = [];
        const dispatcher = makeControllers(
            {
                folders: (p) => pageFor("folders", p),
                list: (p) => pageFor("list", p),
                message: (p) => pageFor("message", p),
            },
            calls,
        );
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: threeColumns() }),
        );

        await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        expect(calls).toEqual(["folders", "list", "message"]);
        calls.length = 0;

        const snap = await controller.perform({
            kind: "setVisibility",
            visibility: SPLIT_VISIBILITIES.DETAIL_ONLY,
        });
        expect(snap.destinations.map((d) => d.intent)).toEqual(["message"]);
        expect(snap.tree).toMatchObject({ kind: "split", visibility: "detailOnly" });
        // message 在上轮已解析 → 复用；sidebar/content 不在可见集 → 不派发。
        expect(calls).toEqual([]);
    });

    test("detailOnly → all：补派发新变可见的 sidebar/content，detail 复用", async () => {
        const calls: string[] = [];
        const dispatcher = makeControllers(
            {
                folders: (p) => pageFor("folders", p),
                list: (p) => pageFor("list", p),
                message: (p) => pageFor("message", p),
            },
            calls,
        );
        const initial = split(
            [
                { id: "sidebar", content: leaf("folders") },
                { id: "content", content: leaf("list") },
                { id: "detail", content: leaf("message") },
            ],
            SPLIT_VISIBILITIES.DETAIL_ONLY,
        );
        const controller = createWebSession(makeOptions({ controllers: dispatcher, initial }));

        await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        expect(calls).toEqual(["message"]); // detailOnly：只预取 detail
        calls.length = 0;

        const snap = await controller.perform({
            kind: "setVisibility",
            visibility: SPLIT_VISIBILITIES.ALL,
        });
        expect(snap.destinations.map((d) => d.intent)).toEqual(["folders", "list", "message"]);
        // 新变可见的 folders/list 派发；message 复用。
        expect(calls).toEqual(["folders", "list"]);
    });

    test("apply({ kind: SET_VISIBILITY }) 与便捷方法等价", async () => {
        const dispatcher = makeControllers({
            folders: (p) => pageFor("folders", p),
            message: (p) => pageFor("message", p),
        });
        const controller = createWebSession(
            makeOptions({
                controllers: dispatcher,
                initial: split([
                    { id: "sidebar", content: leaf("folders") },
                    { id: "detail", content: leaf("message") },
                ]),
            }),
        );
        await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        const snap = await controller.perform({
            kind: ACTION_KINDS.SET_VISIBILITY,
            visibility: SPLIT_VISIBILITIES.DETAIL_ONLY,
        });
        expect(snap.destinations.map((d) => d.intent)).toEqual(["message"]);
    });
});

// =====================================================================
// invalidate / refresh：opt-in 取新鲜数据
// =====================================================================

describe("invalidate / refresh", () => {
    test("refresh 重新 dispatch 当前激活叶子（清其缓存 + 重解析）", async () => {
        const calls: string[] = [];
        const dispatcher = makeControllers({ home: (p) => pageFor("home", p) }, calls);
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: stack(leaf("home")) }),
        );
        await controller.perform({ kind: "hydrate", tree: controller.getTree() }); // [home]

        const snap = await controller.perform({ kind: "refresh" });

        expect(calls).toEqual(["home", "home"]); // active leaf 重新 dispatch
        expect(snap.destinations[0].intent).toBe("home");
    });

    test("invalidate(entryKey) 使该条目下次 reveal 时重新 dispatch", async () => {
        const calls: string[] = [];
        const dispatcher = makeControllers(
            { root: (p) => pageFor("root", p), detail: (p) => pageFor("detail", p) },
            calls,
        );
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: stack(leaf("root")) }),
        );
        await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        await controller.perform({ kind: "push", intent: "detail" });

        controller.invalidate(fixtureEntryId("root", {})); // 清 root 缓存
        await controller.perform({ kind: "pop" }); // root 被 invalidate → 重新 dispatch（而非复用）

        expect(calls).toEqual(["root", "detail", "root"]);
    });

    test("invalidate() 无参清空整个缓存", async () => {
        const calls: string[] = [];
        const dispatcher = makeControllers(
            { root: (p) => pageFor("root", p), detail: (p) => pageFor("detail", p) },
            calls,
        );
        const controller = createWebSession(
            makeOptions({ controllers: dispatcher, initial: stack(leaf("root")) }),
        );
        await controller.perform({ kind: "hydrate", tree: controller.getTree() });
        await controller.perform({ kind: "push", intent: "detail" });

        controller.invalidate(); // 清全部
        await controller.perform({ kind: "pop" });

        expect(calls).toEqual(["root", "detail", "root"]);
    });
});

test("cancelled handlers cannot block a new generation, and release their own scope after settling", async () => {
    let start!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
        start = resolve;
    });
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const events: string[] = [];
    const web = createWebRuntime({
        definition: defineWebApp({
            id: "cancel-generation",
            pages: [
                {
                    id: "slow",
                    handler: async (_input, context) => {
                        context.onDispose(() => {
                            events.push("slow disposed");
                        });
                        start();
                        await gate; // Simulates an API that does not implement AbortSignal.
                        return pageFor("slow", {});
                    },
                },
                { id: "fast", handler: () => pageFor("fast", {}) },
            ],
            getErrorPage: (_status, title) => pageFor(title, {}),
        }),
    });
    const nav = createWebSession({ web, initial: leaf("slow") });
    const old = nav.perform({ kind: "hydrate", tree: nav.getTree() });
    const rejected = expect(old).rejects.toMatchObject({ code: "cancelled" });
    await entered;
    nav.cancel();
    try {
        const latest = await nav.perform({ kind: "hydrate", tree: leaf("fast") });
        expect(latest.destinations[0].intent).toBe("fast");
        expect(events).toEqual([]);
        release();
        await rejected;
        expect(nav.getSnapshot()).toBe(latest);
        expect(events).toEqual(["slow disposed"]);
    } finally {
        release();
        await nav.dispose();
        await web.dispose();
    }
});

test.each(["hydrate", "refresh"] as const)(
    "queued %s is invalidated by cancel and disposal at submission generation",
    async (method) => {
        const { createWebRuntime, defineWebApp } = await import("../../src/index");
        for (const stop of ["cancel", "dispose"] as const) {
            let start!: () => void, release!: () => void;
            const started = new Promise<void>((resolve) => {
                start = resolve;
            });
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            let calls = 0,
                commits = 0;
            const framework = createWebRuntime({
                definition: defineWebApp({
                    pages: routePages(
                        [
                            {
                                id: "home",
                                handler: async () => {
                                    calls++;
                                    start();
                                    await gate;
                                    return pageFor("home", {});
                                },
                            },
                        ],
                        [],
                    ),
                    id: "queue",
                    getErrorPage: (_status, message) => pageFor(message, {}),
                }),
            });
            const nav = createWebSession({ web: framework, initial: leaf("home") });
            nav.subscribe(() => {
                commits++;
            });
            const first = nav.perform({ kind: "hydrate", tree: nav.getTree() });
            await started;
            const second = nav.perform(
                method === "hydrate" ? { kind: method, tree: nav.getTree() } : { kind: method },
            );
            const outcomes = Promise.allSettled([first, second]);
            const stopping = nav[stop]();
            release();
            expect(
                (await outcomes).map((result) =>
                    result.status === "rejected"
                        ? (result.reason as { code: string }).code
                        : "fulfilled",
                ),
            ).toEqual(["cancelled", "cancelled"]);
            await stopping;
            expect(calls).toBe(1);
            expect(commits).toBe(0);
            await nav.dispose();
            await framework.dispose();
        }
    },
);
