import { expect, test } from "vite-plus/test";
import {
    BaseController,
    ExecutionError,
    int,
    list,
    oneOf,
    optional,
    str,
    withDefault,
    type ExecutionContext,
    type ControllerInput,
} from "@finesoft/core";
import {
    createWebRuntime,
    createWebSession,
    definePage,
    defineWebApp,
    loadPage,
    stack,
    type BasePage,
} from "../../src/index";

test("aliases share inferred controller inputs through URL and structured navigation", async () => {
    const calls: unknown[] = [];
    let instances = 0;
    const item = definePage({
        id: "item",
        routes: [
            {
                path: "/items/:id",
                params: { id: int() },
                query: {
                    tags: list(str()),
                    sort: optional(oneOf(["asc", "desc"])),
                    page: withDefault(int(), 1),
                },
            },
            {
                path: "/products/:id",
                params: { id: int() },
                query: {
                    tags: list(str()),
                    sort: optional(oneOf(["asc", "desc"])),
                    page: withDefault(int(), 1),
                },
            },
        ],
        create: () => {
            instances++;
            return {
                perform(params, context, query) {
                    expect(context.signal.aborted).toBe(false);
                    calls.push({ params, query });
                    return {
                        id: params.id.toFixed(),
                        pageType: "item",
                        title: String(query.page),
                    };
                },
            };
        },
    });
    const web = createWebRuntime({
        definition: defineWebApp({
            id: "route-inputs",
            pages: [item],
            getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
        }),
    });
    try {
        expect((await loadPage({ web, target: "/items/42?tags=a&tags=b&sort=asc" })).kind).toBe(
            "page",
        );
        expect((await loadPage({ web, target: "/products/7" })).kind).toBe("page");
        expect(calls).toEqual([
            { params: { id: 42 }, query: { tags: ["a", "b"], sort: "asc", page: 1 } },
            { params: { id: 7 }, query: { tags: [], sort: undefined, page: 1 } },
        ]);
        expect(instances).toBe(2);
        expect(await loadPage({ web, target: "/items/not-an-integer" })).toMatchObject({
            kind: "deny",
            status: 404,
        });
        expect(instances).toBe(2);
        const session = createWebSession({
            web,
            initial: stack(item.leaf({ id: 1 }, { url: "/items/1", query: { tags: [], page: 1 } })),
        });
        try {
            await session.start();
            await session.perform({
                kind: "push",
                intent: "item",
                params: { id: 2 },
                query: { tags: ["c"], page: 3 },
                url: "/products/2?tags=c&page=3",
            });
            expect(calls.at(-1)).toEqual({
                params: { id: 2 },
                query: { tags: ["c"], sort: undefined, page: 3 },
            });
        } finally {
            await session.dispose();
        }
    } finally {
        await web.dispose();
    }
});

test("class controllers retain ownership and error normalization", async () => {
    const receivers: unknown[] = [];
    let instances = 0;
    class ItemController extends BaseController<ControllerInput<{ id: number }>, BasePage> {
        execute({ params, context }: { params: { id: number }; context: ExecutionContext }) {
            receivers.push(this);
            expect(context.signal.aborted).toBe(false);
            if (params.id === 1) throw "failed";
            return { id: params.id.toFixed(), pageType: "item", title: "Loaded" };
        }
        fallback({
            params,
            error,
            context,
        }: {
            params: { id: number };
            error: Error;
            context: ExecutionContext;
        }) {
            receivers.push(this);
            expect(error).toBeInstanceOf(Error);
            expect(context.signal.aborted).toBe(false);
            return { id: params.id.toFixed(), pageType: "item", title: error.message };
        }
    }
    const item = definePage({
        id: "recoverable",
        routes: [{ path: "/items/:id", params: { id: int() } }],
        create: () => {
            instances++;
            return new ItemController();
        },
    });
    const web = createWebRuntime({
        definition: defineWebApp({
            id: "recovery",
            pages: [item],
            getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
        }),
    });
    try {
        expect(await loadPage({ web, target: "/items/1" })).toMatchObject({
            kind: "page",
            page: { id: "1", title: "failed" },
        });
        expect(await loadPage({ web, target: "/items/2" })).toMatchObject({
            kind: "page",
            page: { id: "2", title: "Loaded" },
        });
        expect(instances).toBe(2);
        expect(receivers[1]).toBe(receivers[0]);
        expect(receivers[2]).not.toBe(receivers[0]);
    } finally {
        await web.dispose();
    }
});

test.each(["signal", "abort-error", "execution-error"])(
    "class controller cancellation bypasses fallback: %s",
    async (kind) => {
        const abort = new AbortController();
        let recoveries = 0;
        class ItemController extends BaseController<ControllerInput<{ id: number }>, BasePage> {
            async execute({ params }: { params: { id: number } }) {
                await Promise.resolve();
                if (kind === "abort-error") throw new DOMException("cancelled", "AbortError");
                if (kind === "execution-error") throw new ExecutionError("cancelled");
                abort.abort();
                return { id: params.id.toFixed(), pageType: "item", title: "Cancelled" };
            }
            fallback({ params }: { params: { id: number } }) {
                recoveries++;
                return { id: params.id.toFixed(), pageType: "item", title: "Recovered" };
            }
        }
        const item = definePage({
            id: "cancelled",
            routes: [{ path: "/items/:id", params: { id: int() } }],
            create: () => new ItemController(),
        });
        const web = createWebRuntime({
            definition: defineWebApp({
                id: "cancellation",
                pages: [item],
                getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
            }),
        });
        try {
            await expect(
                loadPage({ web, target: "/items/1", signal: abort.signal }),
            ).rejects.toMatchObject({ code: "cancelled" });
            expect(recoveries).toBe(0);
        } finally {
            await web.dispose();
        }
    },
);

test("class controllers propagate errors when no fallback is defined", async () => {
    class ItemController extends BaseController<ControllerInput<{ id: string }>, BasePage> {
        execute(): never {
            throw new Error("failed");
        }
    }
    const item = definePage({
        id: "failed",
        routes: ["/items/:id"],
        create: () => new ItemController(),
    });
    const web = createWebRuntime({
        definition: defineWebApp({
            id: "no-fallback",
            pages: [item],
            getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
        }),
    });
    try {
        expect(await loadPage({ web, target: "/items/1" })).toMatchObject({
            kind: "deny",
            status: 500,
        });
    } finally {
        await web.dispose();
    }
});

test("string aliases and optional path parameters retain their runtime representation", async () => {
    const seen: unknown[] = [];
    const item = definePage({
        id: "plain",
        routes: ["/items/:id/:tab?", "/alias/:id/:tab?"],
        handler(params) {
            seen.push(params);
            return { id: params.id, pageType: "item", title: params.tab ?? "default" };
        },
    });
    const web = createWebRuntime({
        definition: defineWebApp({
            id: "plain-inputs",
            pages: [item],
            getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
        }),
    });
    try {
        await loadPage({ web, target: "/items/42" });
        await loadPage({ web, target: "/alias/42/details" });
        expect(seen).toEqual([{ id: "42" }, { id: "42", tab: "details" }]);
    } finally {
        await web.dispose();
    }
});

test("controller object input separates query from params through recovery and guarded navigation", async () => {
    const seen: unknown[] = [];
    class ItemController extends BaseController<
        ControllerInput<{ id: number }, { id: string; tags: string[] }>,
        BasePage
    > {
        execute({
            params,
            query,
            context,
        }: import("@finesoft/core").ControllerInput<
            { id: number },
            { id: string; tags: string[] }
        >) {
            seen.push({ params, query, signal: context.signal.aborted });
            if (query.id === "recover") throw Error("recovering");
            return { id: String(params.id), pageType: "item", title: query.id };
        }
        fallback({
            params,
            query,
            error,
            context,
        }: import("@finesoft/core").ControllerFailure<
            { id: number },
            { id: string; tags: string[] }
        >) {
            expect(context.signal.aborted).toBe(false);
            return {
                id: String(params.id),
                pageType: "item",
                title: `${query.id}:${error.message}`,
            };
        }
    }
    const item = definePage({
        id: "item",
        routes: [
            { path: "/items/:id", params: { id: int() }, query: { id: str(), tags: list(str()) } },
        ],
        create: () => new ItemController(),
    });
    const web = createWebRuntime({
        definition: defineWebApp({
            id: "object-input",
            pages: [item],
            getErrorPage: (_, title) => ({ id: "error", pageType: "error", title }),
            beforeLoad: [
                ({ params, query }) => {
                    expect(typeof params.id).toBe("number");
                    expect(typeof query.id).toBe("string");
                    return { kind: "next" };
                },
            ],
        }),
    });
    const session = createWebSession({
        web,
        initial: stack(item.leaf({ id: 1 }, { query: { id: "first", tags: ["a", "b"] } })),
    });
    try {
        expect((await session.start()).destinations[0].page.title).toBe("first");
        const entry = session.getTree();
        await session.perform({
            kind: "push",
            intent: "item",
            params: { id: 2 },
            query: { id: "recover", tags: [] },
        });
        expect(session.getSnapshot().destinations.at(-1)?.page.title).toBe("recover:recovering");
        expect(seen).toEqual([
            { params: { id: 1 }, query: { id: "first", tags: ["a", "b"] }, signal: false },
            { params: { id: 2 }, query: { id: "recover", tags: [] }, signal: false },
        ]);
        expect(entry.kind).toBe("stack");
    } finally {
        await session.dispose();
        await web.dispose();
    }
});
