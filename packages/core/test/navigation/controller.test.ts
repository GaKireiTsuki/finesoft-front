import { describe, expect, test, vi } from "vite-plus/test";
import { Container } from "../../src/dependencies/container";
import { IntentDispatcher } from "../../src/intents/dispatcher";
import type { Intent, IntentController } from "../../src/intents/types";
import { deny, next, redirect, rewrite } from "../../src/middleware/types";
import type {
    AfterLoadGuard,
    BeforeLoadGuard,
    NavigationContext,
} from "../../src/middleware/types";
import type { BasePage } from "../../src/models/page";
import { PrefetchedIntents } from "../../src/prefetched-intents/prefetched-intents";
import { Router } from "../../src/router/router";
import {
    NAVIGATION_OP_KINDS,
    createNavigationController,
    type NavigationControllerOptions,
    type NavigationDispatchContext,
} from "../../src/navigation/controller";
import { leaf, split, stack, tabs } from "../../src/navigation/nodes";
import { SPLIT_VISIBILITIES, type NavigationNode } from "../../src/navigation/types";

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
function makeDispatcher(
    handlers: Record<string, (params: Record<string, unknown>) => BasePage>,
    calls?: string[],
): IntentDispatcher {
    const dispatcher = new IntentDispatcher();
    for (const intentId of Object.keys(handlers)) {
        const controller: IntentController = {
            intentId,
            perform(intent: Intent): BasePage {
                calls?.push(intentId);
                return handlers[intentId](intent.params ?? {});
            },
        };
        dispatcher.register(controller);
    }
    return dispatcher;
}

/** 一个抛错的 controller（验证 dispatch 失败的兜底语义）。 */
function makeThrowingDispatcher(intentId: string, calls?: string[]): IntentDispatcher {
    const dispatcher = new IntentDispatcher();
    dispatcher.register({
        intentId,
        perform(): BasePage {
            calls?.push(intentId);
            throw new Error(`boom:${intentId}`);
        },
    });
    return dispatcher;
}

/** 构建一个 createContext 回调（返回 Container；可附 url）。 */
function contextFactory(url?: string): NavigationControllerOptions["createContext"] {
    const container = new Container();
    return (): NavigationDispatchContext => ({ container, url });
}

/** 默认选项装配器：只需给 dispatcher + initial，其余取默认。 */
function makeOptions(
    overrides: Partial<NavigationControllerOptions> &
        Pick<NavigationControllerOptions, "intentDispatcher" | "initial">,
): NavigationControllerOptions {
    return {
        router: new Router(),
        createContext: contextFactory(),
        ...overrides,
    };
}

// =====================================================================
// 向后兼容：单 LeafNode = 今天的扁平单页
// =====================================================================

describe("single leaf (backward-compatible flat page)", () => {
    test("resolve() dispatches the one intent and yields one destination", async () => {
        const calls: string[] = [];
        const dispatcher = makeDispatcher({ home: (p) => pageFor("home", p) }, calls);
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: leaf("home", { a: 1 }) }),
        );

        const snap = await controller.resolve();

        expect(calls).toEqual(["home"]);
        expect(snap.destinations).toHaveLength(1);
        expect(snap.destinations[0].intent).toBe("home");
        expect(snap.destinations[0].params).toEqual({ a: 1 });
        expect(snap.destinations[0].page.pageType).toBe("home");
        expect(snap.destinations[0].status).toBeUndefined();
        expect(snap.tree).toEqual(leaf("home", { a: 1 }));
    });

    test("getTree / getSnapshot reflect committed state", async () => {
        const dispatcher = makeDispatcher({ home: (p) => pageFor("home", p) });
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: leaf("home") }),
        );

        // 解析前：tree = initial，destinations 空
        expect(controller.getTree()).toEqual(leaf("home"));
        expect(controller.getSnapshot().destinations).toEqual([]);

        const snap = await controller.resolve();
        expect(controller.getSnapshot()).toBe(snap);
        expect(controller.getTree()).toBe(snap.tree);
    });
});

// =====================================================================
// 栈操作：push / pop / popToRoot / replaceTop（便捷方法 + apply）
// =====================================================================

describe("stack operations", () => {
    function stackController(calls: string[]): ReturnType<typeof createNavigationController> {
        const dispatcher = makeDispatcher(
            {
                root: (p) => pageFor("root", p),
                detail: (p) => pageFor("detail", p),
                edit: (p) => pageFor("edit", p),
            },
            calls,
        );
        return createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: stack(leaf("root")) }),
        );
    }

    test("push appends a new leaf on the active stack and dispatches it", async () => {
        const calls: string[] = [];
        const controller = stackController(calls);
        await controller.resolve(); // ["root"]

        const snap = await controller.push("detail", { id: 7 });

        expect(calls).toEqual(["root", "detail"]);
        // 栈顶 detail 是唯一可见目标
        expect(snap.destinations).toHaveLength(1);
        expect(snap.destinations[0].intent).toBe("detail");
        expect(snap.destinations[0].params).toEqual({ id: 7 });
        // 树结构：root + detail
        expect(snap.tree).toEqual(stack([leaf("root"), leaf("detail", { id: 7 })]));
    });

    test("pop drops the top entry; the now-visible root is newly-visible → re-dispatched", async () => {
        const calls: string[] = [];
        const controller = stackController(calls);
        await controller.resolve();
        await controller.push("detail"); // prev snapshot's only visible dest = detail

        const snap = await controller.pop();

        // root 不在「上一」快照（只有 detail）→ 重新可见 → 重新 dispatch
        // （跨 history 的页复用是 bridge 的职责，非 controller）
        expect(calls).toEqual(["root", "detail", "root"]);
        expect(snap.destinations).toHaveLength(1);
        expect(snap.destinations[0].intent).toBe("root");
        expect(snap.tree).toEqual(stack([leaf("root")]));
    });

    test("a destination unchanged FROM THE PREVIOUS snapshot is reused (split column)", async () => {
        const calls: string[] = [];
        const dispatcher = makeDispatcher(
            { list: (p) => pageFor("list", p), detail: (p) => pageFor("detail", p) },
            calls,
        );
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: split([{ id: "list", content: leaf("list") }, { id: "detail" }]),
            }),
        );
        await controller.resolve(); // list dispatched

        // 设置 detail 列：list 列在上一快照里未变 → 复用，仅 detail 新 dispatch
        await controller.selectColumn("detail", "detail");
        expect(calls).toEqual(["list", "detail"]);
    });

    test("pop never drops below root entry", async () => {
        const calls: string[] = [];
        const controller = stackController(calls);
        await controller.resolve();

        const snap = await controller.pop(5);

        expect(snap.tree).toEqual(stack([leaf("root")]));
        expect(snap.destinations[0].intent).toBe("root");
    });

    test("replaceTop swaps the top entry", async () => {
        const calls: string[] = [];
        const controller = stackController(calls);
        await controller.resolve();
        await controller.push("detail");

        const snap = await controller.replaceTop("edit", { id: 1 });

        expect(snap.tree).toEqual(stack([leaf("root"), leaf("edit", { id: 1 })]));
        expect(snap.destinations[0].intent).toBe("edit");
        expect(calls).toEqual(["root", "detail", "edit"]);
    });

    test("popToRoot via generic apply", async () => {
        const calls: string[] = [];
        const controller = stackController(calls);
        await controller.resolve();
        await controller.push("detail");
        await controller.push("edit");

        const snap = await controller.apply({ kind: NAVIGATION_OP_KINDS.POP_TO_ROOT });

        expect(snap.tree).toEqual(stack([leaf("root")]));
        expect(snap.destinations[0].intent).toBe("root");
    });

    test("popTo via generic apply keeps [0..index]", async () => {
        const calls: string[] = [];
        const dispatcher = makeDispatcher(
            { a: (p) => pageFor("a", p), b: (p) => pageFor("b", p), c: (p) => pageFor("c", p) },
            calls,
        );
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: stack([leaf("a"), leaf("b"), leaf("c")]),
            }),
        );
        await controller.resolve(); // only top "c" is visible → ["c"]

        const snap = await controller.apply({ kind: NAVIGATION_OP_KINDS.POP_TO, index: 0 });

        expect(snap.tree).toEqual(stack([leaf("a")]));
        expect(snap.destinations[0].intent).toBe("a");
        expect(calls).toEqual(["c", "a"]);
    });
});

// =====================================================================
// Tabs：多分支只解析激活分支；切换 tab 复用页
// =====================================================================

describe("tabs", () => {
    test("only the active branch is visible + dispatched", async () => {
        const calls: string[] = [];
        const dispatcher = makeDispatcher(
            { home: (p) => pageFor("home", p), profile: (p) => pageFor("profile", p) },
            calls,
        );
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: tabs({
                    active: "home",
                    branches: { home: leaf("home"), profile: leaf("profile") },
                }),
            }),
        );

        const snap = await controller.resolve();

        expect(calls).toEqual(["home"]);
        expect(snap.destinations).toHaveLength(1);
        expect(snap.destinations[0].intent).toBe("home");
    });

    test("selectTab switches active branch and dispatches the new one", async () => {
        const calls: string[] = [];
        const dispatcher = makeDispatcher(
            { home: (p) => pageFor("home", p), profile: (p) => pageFor("profile", p) },
            calls,
        );
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: tabs({
                    active: "home",
                    branches: { home: leaf("home"), profile: leaf("profile") },
                }),
            }),
        );
        await controller.resolve();

        const snap = await controller.selectTab("profile");

        expect(calls).toEqual(["home", "profile"]);
        expect(snap.destinations[0].intent).toBe("profile");

        // 切回 home：home 不在「上一」快照（只有 profile）→ 重新可见 → 重新 dispatch
        const back = await controller.selectTab("home");
        expect(calls).toEqual(["home", "profile", "home"]);
        expect(back.destinations[0].intent).toBe("home");
    });
});

// =====================================================================
// Split：所有非空列都可见；secondary 列也被 dispatch（无守卫）
// =====================================================================

describe("split", () => {
    test("all non-empty columns are visible and ordered like collectVisibleDestinations", async () => {
        const calls: string[] = [];
        const dispatcher = makeDispatcher(
            { list: (p) => pageFor("list", p), detail: (p) => pageFor("detail", p) },
            calls,
        );
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: split([
                    { id: "list", content: leaf("list") },
                    { id: "detail", content: leaf("detail") },
                ]),
            }),
        );

        const snap = await controller.resolve();

        expect(snap.destinations.map((d) => d.intent)).toEqual(["list", "detail"]);
        // dispatch 顺序 = 可见顺序
        expect(calls).toEqual(["list", "detail"]);
    });

    test("selectColumn sets a column's content and clears columns after it", async () => {
        const calls: string[] = [];
        const dispatcher = makeDispatcher(
            {
                list: (p) => pageFor("list", p),
                detail: (p) => pageFor("detail", p),
                more: (p) => pageFor("more", p),
            },
            calls,
        );
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: split([{ id: "list", content: leaf("list") }, { id: "detail" }]),
            }),
        );
        await controller.resolve(); // ["list"]

        const snap = await controller.selectColumn("detail", "detail", { id: 9 });

        expect(snap.destinations.map((d) => d.intent)).toEqual(["list", "detail"]);
        // list 复用首屏，仅 detail 新 dispatch
        expect(calls).toEqual(["list", "detail"]);
        expect(snap.tree).toEqual(
            split([
                { id: "list", content: leaf("list") },
                { id: "detail", content: leaf("detail", { id: 9 }) },
            ]),
        );
    });

    test("selectColumn with undefined intent clears the column", async () => {
        const dispatcher = makeDispatcher({
            list: (p) => pageFor("list", p),
            detail: (p) => pageFor("detail", p),
        });
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: split([
                    { id: "list", content: leaf("list") },
                    { id: "detail", content: leaf("detail") },
                ]),
            }),
        );
        await controller.resolve();

        const snap = await controller.selectColumn("detail", undefined);

        expect(snap.destinations.map((d) => d.intent)).toEqual(["list"]);
        expect(snap.tree).toEqual(split([{ id: "list", content: leaf("list") }, { id: "detail" }]));
    });
});

// =====================================================================
// 守卫：beforeLoad next/deny/redirect/rewrite
// =====================================================================

describe("beforeLoad guards (primary destination)", () => {
    test("next → dispatch proceeds normally", async () => {
        const calls: string[] = [];
        const guard: BeforeLoadGuard = () => next();
        const dispatcher = makeDispatcher({ home: (p) => pageFor("home", p) }, calls);
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: leaf("home"),
                beforeLoad: [guard],
            }),
        );

        const snap = await controller.resolve();
        expect(calls).toEqual(["home"]);
        expect(snap.destinations[0].status).toBeUndefined();
    });

    test("deny → status set, intent NOT dispatched, error page used", async () => {
        const calls: string[] = [];
        const guard: BeforeLoadGuard = () => deny(403, "nope");
        const dispatcher = makeDispatcher({ secret: (p) => pageFor("secret", p) }, calls);
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: leaf("secret"),
                beforeLoad: [guard],
            }),
        );

        const snap = await controller.resolve();

        expect(calls).toEqual([]); // 未 dispatch
        expect(snap.destinations).toHaveLength(1);
        expect(snap.destinations[0].status).toBe(403);
        expect(snap.destinations[0].page.pageType).toBe("error");
    });

    test("deny uses custom getErrorPage", async () => {
        const guard: BeforeLoadGuard = () => deny(401, "login");
        const dispatcher = makeDispatcher({ secret: (p) => pageFor("secret", p) });
        const getErrorPage = vi.fn(
            (status: number, message: string): BasePage => ({
                id: "custom-error",
                pageType: "custom-error",
                title: `${status}/${message}`,
            }),
        );
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: leaf("secret"),
                beforeLoad: [guard],
                getErrorPage,
            }),
        );

        const snap = await controller.resolve();
        expect(getErrorPage).toHaveBeenCalledWith(401, "login");
        expect(snap.destinations[0].page.pageType).toBe("custom-error");
    });

    test("redirect → onRedirect called, intent NOT dispatched", async () => {
        const calls: string[] = [];
        const onRedirect = vi.fn();
        const guard: BeforeLoadGuard = () => redirect("/login", 302);
        const dispatcher = makeDispatcher({ secret: (p) => pageFor("secret", p) }, calls);
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: leaf("secret"),
                beforeLoad: [guard],
                onRedirect,
            }),
        );

        const snap = await controller.resolve();

        expect(onRedirect).toHaveBeenCalledWith({ url: "/login", status: 302 });
        expect(calls).toEqual([]);
        expect(snap.destinations[0].status).toBe(302);
    });

    test("rewrite → re-route to new URL, swap intent/params for the primary destination", async () => {
        const calls: string[] = [];
        const router = new Router();
        router.add("/canonical/:id", "canonical");
        const guard: BeforeLoadGuard = () => rewrite("/canonical/42");
        const dispatcher = makeDispatcher(
            { alias: (p) => pageFor("alias", p), canonical: (p) => pageFor("canonical", p) },
            calls,
        );
        const controller = createNavigationController({
            intentDispatcher: dispatcher,
            router,
            initial: leaf("alias"),
            createContext: contextFactory(),
            beforeLoad: [guard],
        });

        const snap = await controller.resolve();

        // alias 没 dispatch；canonical 被 dispatch
        expect(calls).toEqual(["canonical"]);
        expect(snap.destinations[0].intent).toBe("canonical");
        expect(snap.destinations[0].params).toEqual({ id: "42" });
    });

    test("rewrite to an unroutable URL keeps the original destination", async () => {
        const calls: string[] = [];
        const router = new Router(); // 无路由 → resolve 返回 null
        const guard: BeforeLoadGuard = () => rewrite("/nope");
        const dispatcher = makeDispatcher({ alias: (p) => pageFor("alias", p) }, calls);
        const controller = createNavigationController({
            intentDispatcher: dispatcher,
            router,
            initial: leaf("alias"),
            createContext: contextFactory(),
            beforeLoad: [guard],
        });

        const snap = await controller.resolve();
        // 回退：仍按原 intent 解析
        expect(calls).toEqual(["alias"]);
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
        const dispatcher = makeDispatcher({ home: (p) => pageFor("home", p) });
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: leaf("home"),
                afterLoad: [guard],
            }),
        );

        const snap = await controller.resolve();
        expect(seen).toHaveLength(1);
        expect(seen[0].pageType).toBe("home");
        expect(snap.destinations[0].status).toBeUndefined();
    });

    test("afterLoad deny → status set but the already-loaded page is kept", async () => {
        const guard: AfterLoadGuard = () => deny(403, "blocked");
        const dispatcher = makeDispatcher({ home: (p) => pageFor("home", p) });
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: leaf("home"),
                afterLoad: [guard],
            }),
        );

        const snap = await controller.resolve();
        expect(snap.destinations[0].status).toBe(403);
        // 与现有 runner 一致：afterLoad deny 保留已加载页
        expect(snap.destinations[0].page.pageType).toBe("home");
    });

    test("afterLoad redirect → onRedirect called, page kept (no status error page)", async () => {
        const onRedirect = vi.fn();
        const guard: AfterLoadGuard = () => redirect("/elsewhere", 302);
        const dispatcher = makeDispatcher({ home: (p) => pageFor("home", p) });
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: leaf("home"),
                afterLoad: [guard],
                onRedirect,
            }),
        );

        const snap = await controller.resolve();
        expect(onRedirect).toHaveBeenCalledWith({ url: "/elsewhere", status: 302 });
        expect(snap.destinations[0].page.pageType).toBe("home");
        expect(snap.destinations[0].status).toBe(302);
    });

    test("afterLoad rewrite → page kept, NO status (canonical URL only)", async () => {
        const guard: AfterLoadGuard = () => rewrite("/canonical");
        const dispatcher = makeDispatcher({ home: (p) => pageFor("home", p) });
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: leaf("home"),
                afterLoad: [guard],
            }),
        );

        const snap = await controller.resolve();
        expect(snap.destinations[0].page.pageType).toBe("home");
        expect(snap.destinations[0].status).toBeUndefined();
    });

    test("guards run ONLY for the primary destination, not for secondary split columns", async () => {
        const guardCalls: string[] = [];
        const guard: BeforeLoadGuard = (ctx: NavigationContext) => {
            guardCalls.push(ctx.intent.id);
            return next();
        };
        const dispatcher = makeDispatcher({
            list: (p) => pageFor("list", p),
            detail: (p) => pageFor("detail", p),
        });
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: split([
                    { id: "list", content: leaf("list") },
                    { id: "detail", content: leaf("detail") },
                ]),
                beforeLoad: [guard],
            }),
        );

        await controller.resolve();
        // 激活路径末端 = 最后一个非空列 detail → 仅它跑守卫
        expect(guardCalls).toEqual(["detail"]);
    });
});

// =====================================================================
// dispatch 失败：兜底页 + status=500，不抛出 apply
// =====================================================================

describe("dispatch failure handling", () => {
    test("a throwing controller does not throw out of resolve; surfaces status 500 + error page", async () => {
        const calls: string[] = [];
        const dispatcher = makeThrowingDispatcher("home", calls);
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: leaf("home") }),
        );

        const snap = await controller.resolve();

        expect(calls).toEqual(["home"]);
        expect(snap.destinations).toHaveLength(1);
        expect(snap.destinations[0].status).toBe(500);
        expect(snap.destinations[0].page.pageType).toBe("error");
    });

    test("a failing secondary column does not sink the whole snapshot", async () => {
        const dispatcher = new IntentDispatcher();
        dispatcher.register({
            intentId: "ok",
            perform: (i: Intent): BasePage => pageFor("ok", i.params ?? {}),
        });
        dispatcher.register({
            intentId: "bad",
            perform(): BasePage {
                throw new Error("bad column");
            },
        });
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: split([
                    { id: "a", content: leaf("ok") },
                    { id: "b", content: leaf("bad") },
                ]),
            }),
        );

        const snap = await controller.resolve();
        expect(snap.destinations.map((d) => d.intent)).toEqual(["ok", "bad"]);
        expect(snap.destinations[0].status).toBeUndefined();
        expect(snap.destinations[1].status).toBe(500);
    });

    test("unregistered intent (no controller) is treated as a dispatch failure", async () => {
        const dispatcher = new IntentDispatcher(); // 空：home 无 controller
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: leaf("home") }),
        );

        const snap = await controller.resolve();
        expect(snap.destinations[0].status).toBe(500);
        expect(snap.destinations[0].page.pageType).toBe("error");
    });
});

// =====================================================================
// 预取缓存复用（SSR → CSR hydration）
// =====================================================================

describe("prefetched reuse", () => {
    test("primary destination reuses a prefetched page without dispatching", async () => {
        const calls: string[] = [];
        const dispatcher = makeDispatcher({ home: (p) => pageFor("home", p) }, calls);
        const prefetchedPage: BasePage = { id: "ssr-home", pageType: "home", title: "from-ssr" };
        const prefetched = PrefetchedIntents.fromArray([
            { intent: { id: "home", params: {} }, data: prefetchedPage },
        ]);
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: leaf("home"), prefetched }),
        );

        const snap = await controller.resolve();

        expect(calls).toEqual([]); // 命中预取缓存，未走 controller
        expect(snap.destinations[0].page.title).toBe("from-ssr");
    });

    test("secondary destination also reuses prefetched results", async () => {
        const calls: string[] = [];
        const dispatcher = makeDispatcher(
            { list: (p) => pageFor("list", p), detail: (p) => pageFor("detail", p) },
            calls,
        );
        const prefetched = PrefetchedIntents.fromArray([
            { intent: { id: "list", params: {} }, data: { id: "x", pageType: "list", title: "L" } },
            {
                intent: { id: "detail", params: {} },
                data: { id: "y", pageType: "detail", title: "D" },
            },
        ]);
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: split([
                    { id: "list", content: leaf("list") },
                    { id: "detail", content: leaf("detail") },
                ]),
                prefetched,
            }),
        );

        const snap = await controller.resolve();
        expect(calls).toEqual([]);
        expect(snap.destinations.map((d) => d.page.title)).toEqual(["L", "D"]);
    });

    test("prefetched is one-shot: a second resolve of a changed-back destination re-dispatches", async () => {
        const calls: string[] = [];
        const dispatcher = makeDispatcher(
            { home: (p) => pageFor("home", p), other: (p) => pageFor("other", p) },
            calls,
        );
        const prefetched = PrefetchedIntents.fromArray([
            { intent: { id: "home", params: {} }, data: { id: "h", pageType: "home", title: "S" } },
        ]);
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: stack(leaf("home")),
                prefetched,
            }),
        );

        await controller.resolve(); // home from prefetch (consumed), calls=[]
        await controller.push("other"); // calls=[other]; home no longer visible
        // pop back to home: prefetch already consumed AND home not in prev snapshot → must dispatch
        const snap = await controller.pop();

        expect(calls).toEqual(["other", "home"]);
        expect(snap.destinations[0].intent).toBe("home");
    });
});

// =====================================================================
// hydrate：用外部树替换并重解析
// =====================================================================

describe("hydrate", () => {
    test("replaces the tree and re-resolves its visible destinations", async () => {
        const calls: string[] = [];
        const dispatcher = makeDispatcher(
            { home: (p) => pageFor("home", p), detail: (p) => pageFor("detail", p) },
            calls,
        );
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: leaf("home") }),
        );
        await controller.resolve();

        const incoming: NavigationNode = stack([leaf("home"), leaf("detail", { id: 3 })]);
        const snap = await controller.hydrate(incoming);

        expect(snap.tree).toBe(incoming);
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
        const dispatcher = makeDispatcher({
            home: (p) => pageFor("home", p),
            detail: (p) => pageFor("detail", p),
        });
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: stack(leaf("home")) }),
        );
        const received: string[][] = [];
        const unsubscribe = controller.subscribe((snap) => {
            received.push(snap.destinations.map((d) => d.intent));
        });

        await controller.resolve(); // [home]
        await controller.push("detail"); // [detail]

        expect(received).toEqual([["home"], ["detail"]]);

        unsubscribe();
        await controller.pop(); // listener removed → no new entry
        expect(received).toHaveLength(2);
    });

    test("the snapshot passed to listeners equals getSnapshot()", async () => {
        const dispatcher = makeDispatcher({ home: (p) => pageFor("home", p) });
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: leaf("home") }),
        );
        let last: unknown;
        controller.subscribe((snap) => {
            last = snap;
        });
        const snap = await controller.resolve();
        expect(last).toBe(snap);
        expect(last).toBe(controller.getSnapshot());
    });
});

// =====================================================================
// 不可变 / 结构共享：操作不改输入树
// =====================================================================

describe("immutability", () => {
    test("push does not mutate the previous committed tree", async () => {
        const dispatcher = makeDispatcher({
            root: (p) => pageFor("root", p),
            detail: (p) => pageFor("detail", p),
        });
        const initial = stack(leaf("root"));
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial }),
        );
        await controller.resolve();
        const before = controller.getTree();

        await controller.push("detail");

        // 原 committed 树未被改动（结构共享，新树是新引用）
        expect(before).toEqual(stack([leaf("root")]));
        expect(controller.getTree()).not.toBe(before);
    });
});

// =====================================================================
// 无效操作：来自 operations 的 NavigationError 透传出 apply
// =====================================================================

describe("invalid operations propagate NavigationError", () => {
    test("selectTab on a non-tabs tree throws", async () => {
        const dispatcher = makeDispatcher({ home: (p) => pageFor("home", p) });
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: leaf("home") }),
        );
        await controller.resolve();

        await expect(controller.selectTab("whatever")).rejects.toThrow(/没有 tabs/);
    });

    test("push with no stack on the active path throws", async () => {
        const dispatcher = makeDispatcher({ home: (p) => pageFor("home", p) });
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: leaf("home") }),
        );
        await controller.resolve();

        await expect(controller.push("x")).rejects.toThrow(/没有可用的 stack/);
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
function makeSlowDispatcher(intentIds: readonly string[], calls?: string[]): IntentDispatcher {
    const dispatcher = new IntentDispatcher();
    for (const intentId of intentIds) {
        dispatcher.register({
            intentId,
            perform(intent: Intent): Promise<BasePage> {
                calls?.push(intentId);
                return new Promise((resolve) => {
                    // setTimeout(0)：把 resolve 推到宏任务，确保 apply 之间有真实的异步窗口。
                    setTimeout(() => resolve(pageFor(intentId, intent.params ?? {})), 0);
                });
            },
        });
    }
    return dispatcher;
}

describe("concurrent apply() serialization (no last-write-wins race)", () => {
    test("two concurrent pushes both land; neither is dropped", async () => {
        const calls: string[] = [];
        const dispatcher = makeSlowDispatcher(["root", "a", "b"], calls);
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: stack(leaf("root")) }),
        );
        await controller.resolve(); // stack([root])

        // 不 await 第一次：两次 push 同步并发触发。
        const p1 = controller.push("a");
        const p2 = controller.push("b");
        const [snap1, snap2] = await Promise.all([p1, p2]);

        // 串行化后：第一次提交 stack([root, a])，第二次在其之上提交 stack([root, a, b])。
        expect(snap1.tree).toEqual(stack([leaf("root"), leaf("a")]));
        expect(snap2.tree).toEqual(stack([leaf("root"), leaf("a"), leaf("b")]));
        // 最终已提交树两者都在，没有谁被丢。
        expect(controller.getTree()).toEqual(stack([leaf("root"), leaf("a"), leaf("b")]));
    });

    test("many interleaved concurrent pushes apply in submission order", async () => {
        const dispatcher = makeSlowDispatcher(["root", "x0", "x1", "x2", "x3", "x4"]);
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: stack(leaf("root")) }),
        );
        await controller.resolve();

        const pending = [0, 1, 2, 3, 4].map((i) => controller.push(`x${i}`));
        await Promise.all(pending);

        // 全部按提交顺序叠加，无丢失、无错序。
        expect(controller.getTree()).toEqual(
            stack([leaf("root"), leaf("x0"), leaf("x1"), leaf("x2"), leaf("x3"), leaf("x4")]),
        );
    });

    test("a rejected op does not poison the queue; later ops still commit", async () => {
        const calls: string[] = [];
        const dispatcher = makeSlowDispatcher(["root", "ok"], calls);
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: stack(leaf("root")) }),
        );
        await controller.resolve();

        // 第一次操作非法（对 stack 顶 leaf selectTab）→ reject；紧接着的合法 push 必须仍然成功。
        const bad = controller.selectTab("nope");
        const good = controller.push("ok");

        await expect(bad).rejects.toThrow(/没有 tabs/);
        const snap = await good;
        expect(snap.tree).toEqual(stack([leaf("root"), leaf("ok")]));
        expect(controller.getTree()).toEqual(stack([leaf("root"), leaf("ok")]));
    });

    test("concurrent resolve() and apply() do not clobber each other", async () => {
        const dispatcher = makeSlowDispatcher(["root", "next"]);
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: stack(leaf("root")) }),
        );

        // 首屏 resolve 与一次 push 并发：串行队列保证 push 基于 resolve 后的树。
        const r = controller.resolve();
        const p = controller.push("next");
        await Promise.all([r, p]);

        expect(controller.getTree()).toEqual(stack([leaf("root"), leaf("next")]));
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
        const dispatcher = makeDispatcher({ home: (p) => pageFor("home", p) });
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: leaf("home"),
                beforeLoad: [recordingGuard(seen)],
                // createContext 默认不返回 navigation → 走 minimalContext 兜底。
            }),
        );

        await controller.resolve();
        // Node 测试环境无 window → isServer 推断为 true。
        expect(seen).toEqual([true]);
    });

    test("explicit isServer:false overrides the env default in the fallback context", async () => {
        const seen: boolean[] = [];
        const dispatcher = makeDispatcher({ home: (p) => pageFor("home", p) });
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: leaf("home"),
                beforeLoad: [recordingGuard(seen)],
                isServer: false,
            }),
        );

        await controller.resolve();
        // 显式 isServer:false → 兜底上下文报告浏览器侧，守卫据此走客户端分支。
        expect(seen).toEqual([false]);
    });

    test("explicit isServer:true is honored too", async () => {
        const seen: boolean[] = [];
        const dispatcher = makeDispatcher({ home: (p) => pageFor("home", p) });
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: leaf("home"),
                beforeLoad: [recordingGuard(seen)],
                isServer: true,
            }),
        );

        await controller.resolve();
        expect(seen).toEqual([true]);
    });

    test("a supplied navigation context wins over the isServer option", async () => {
        const seen: boolean[] = [];
        const container = new Container();
        const dispatcher = makeDispatcher({ home: (p) => pageFor("home", p) });
        const controller = createNavigationController({
            router: new Router(),
            intentDispatcher: dispatcher,
            initial: leaf("home"),
            beforeLoad: [recordingGuard(seen)],
            // isServer 选项说 true，但 createContext 提供了 isServer:false 的完整 navigation。
            isServer: true,
            createContext: ({ intent, params }): NavigationDispatchContext => ({
                container,
                navigation: {
                    url: "/home",
                    path: "/home",
                    params,
                    intent: { id: intent, params },
                    isServer: false,
                    container,
                    getCookie: () => undefined,
                    getHeader: () => undefined,
                },
            }),
        });

        await controller.resolve();
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
        const dispatcher = makeDispatcher(
            {
                folders: (p) => pageFor("folders", p),
                list: (p) => pageFor("list", p),
                message: (p) => pageFor("message", p),
            },
            calls,
        );
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial: threeColumns() }),
        );

        await controller.resolve();
        expect(calls).toEqual(["folders", "list", "message"]);
        calls.length = 0;

        const snap = await controller.setVisibility(SPLIT_VISIBILITIES.DETAIL_ONLY);
        expect(snap.destinations.map((d) => d.intent)).toEqual(["message"]);
        expect(snap.tree).toMatchObject({ kind: "split", visibility: "detailOnly" });
        // message 在上轮已解析 → 复用；sidebar/content 不在可见集 → 不派发。
        expect(calls).toEqual([]);
    });

    test("detailOnly → all：补派发新变可见的 sidebar/content，detail 复用", async () => {
        const calls: string[] = [];
        const dispatcher = makeDispatcher(
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
        const controller = createNavigationController(
            makeOptions({ intentDispatcher: dispatcher, initial }),
        );

        await controller.resolve();
        expect(calls).toEqual(["message"]); // detailOnly：只预取 detail
        calls.length = 0;

        const snap = await controller.setVisibility(SPLIT_VISIBILITIES.ALL);
        expect(snap.destinations.map((d) => d.intent)).toEqual(["folders", "list", "message"]);
        // 新变可见的 folders/list 派发；message 复用。
        expect(calls).toEqual(["folders", "list"]);
    });

    test("apply({ kind: SET_VISIBILITY }) 与便捷方法等价", async () => {
        const dispatcher = makeDispatcher({
            folders: (p) => pageFor("folders", p),
            message: (p) => pageFor("message", p),
        });
        const controller = createNavigationController(
            makeOptions({
                intentDispatcher: dispatcher,
                initial: split([
                    { id: "sidebar", content: leaf("folders") },
                    { id: "detail", content: leaf("message") },
                ]),
            }),
        );
        await controller.resolve();
        const snap = await controller.apply({
            kind: NAVIGATION_OP_KINDS.SET_VISIBILITY,
            visibility: SPLIT_VISIBILITIES.DETAIL_ONLY,
        });
        expect(snap.destinations.map((d) => d.intent)).toEqual(["message"]);
    });
});
