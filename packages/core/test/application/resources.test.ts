import { expect, test, vi, expectTypeOf } from "vite-plus/test";
import { createRuntime, defineApp, defineOperation, createToken, provide } from "../../src/index";

test("async scope resources are isolated, deduplicated, retryable and disposed in reverse order", async () => {
    const user = createToken<string>("user"),
        service = createToken<string>("service");
    const disposed: string[] = [];
    let attempts = 0;
    const runtime = createRuntime({
        app: defineApp({
            id: "a",
            providers: [
                provide({
                    token: user,
                    lifetime: "scope",
                    create: async (ctx) => {
                        if (++attempts === 1) throw new Error("retry");
                        return String(ctx.bindings.user);
                    },
                    dispose: (v) => {
                        disposed.push(v);
                    },
                }),
                provide({
                    token: service,
                    lifetime: "scope",
                    dependencies: [user],
                    create: async (ctx) => (await ctx.get(user)) + "!",
                    dispose: (v) => {
                        disposed.push(v);
                    },
                }),
            ],
        }),
    });
    const a = runtime.createExecution({ bindings: { user: "a" } }),
        b = runtime.createExecution({ bindings: { user: "b" } });
    const first = a.context.get(user);
    expectTypeOf(first).toEqualTypeOf<Promise<string>>();
    await expect(first).rejects.toThrow("retry");
    expect(
        await Promise.all([a.context.get(service), a.context.get(service), b.context.get(service)]),
    ).toEqual(["a!", "a!", "b!"]);
    expect(attempts).toBe(3);
    await a.dispose();
    expect(disposed).toEqual(["a!", "a"]);
    await runtime.dispose();
    expect(disposed).toEqual(["a!", "a", "b!", "b"]);
    await expect(a.context.get(user)).rejects.toThrow(/closed/);
});

test("disposal awaits pending initialization and cleanup; supplied values are external", async () => {
    const token = createToken<object>("connection");
    let finish!: (value: object) => void;
    const dispose = vi.fn(async () => {});
    const runtime = createRuntime({
        app: defineApp({
            id: "a",
            providers: [
                provide({
                    token,
                    lifetime: "runtime",
                    create: () =>
                        new Promise<object>((resolve) => {
                            finish = resolve;
                        }),
                    dispose,
                }),
            ],
        }),
    });
    const scope = runtime.createExecution();
    const pending = scope.context.get(token);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const closed = runtime.dispose();
    expect(dispose).not.toHaveBeenCalled();
    finish({});
    await pending;
    await closed;
    expect(dispose).toHaveBeenCalledTimes(1);
    await runtime.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    const external = createRuntime({
        app: defineApp({
            id: "b",
            providers: [provide({ token, lifetime: "runtime", value: {}, dispose })],
        }),
    });
    await external.createExecution().context.get(token);
    await external.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
});

test("execution handle retains resources after results and bound fetch inherits abort", async () => {
    const cleanup = vi.fn();
    const fetch = vi.fn(
        async (_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
            expect(init?.signal).toBeInstanceOf(AbortSignal);
            return new Response("ok");
        },
    );
    const op = defineOperation({
        id: "q",
        kind: "query",
        handler: async (_: undefined, ctx) => {
            ctx.onDispose(cleanup);
            return (await ctx.fetch("https://example.com")).text();
        },
    });
    const runtime = createRuntime({
        app: defineApp({ id: "a", operations: [op] }),
        capabilities: { fetch },
    });
    const scope = runtime.createExecution();
    expect(await scope.execute(op, undefined)).toBe("ok");
    expect(cleanup).not.toHaveBeenCalled();
    await scope.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(scope.context.signal.aborted).toBe(true);
    await runtime.dispose();
});

test("runtime providers cannot observe invocation bindings; transients are fresh and all owned cleanup runs", async () => {
    const root = createToken<unknown>("root"),
        fresh = createToken<object>("fresh");
    const cleanup = vi.fn();
    const runtime = createRuntime({
        app: defineApp({
            id: "app",
            providers: [
                provide({ token: root, lifetime: "runtime", create: (ctx) => ctx.bindings.user }),
                provide({
                    token: fresh,
                    lifetime: "transient",
                    create: () => ({}),
                    dispose: cleanup,
                }),
            ],
        }),
    });
    const scope = runtime.createExecution({ bindings: { user: "private" } });
    expect(await scope.context.get(root)).toBeUndefined();
    expect(await scope.context.get(fresh)).not.toBe(await scope.context.get(fresh));
    await scope.dispose();
    expect(cleanup).toHaveBeenCalledTimes(2);
    await runtime.dispose();
});

test("a parent awaits a child that has already started asynchronous disposal", async () => {
    const { Container } = await import("../../src/index");
    const parent = new Container(),
        child = parent.createScope();
    const events: string[] = [];
    let finish!: () => void;
    child.onDispose(async () => {
        events.push("child-start");
        await new Promise<void>((resolve) => {
            finish = resolve;
        });
        events.push("child-end");
    });
    parent.onDispose(() => {
        events.push("parent");
    });
    const childClosing = child.dispose();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const parentClosing = parent.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["child-start"]);
    finish();
    await childClosing;
    await parentClosing;
    expect(events).toEqual(["child-start", "child-end", "parent"]);
});

test("declared dependencies initialize once per factory and dispose after their dependent", async () => {
    const dependency = createToken<object>("dependency"),
        dependent = createToken<object>("dependent");
    const created = vi.fn(() => ({}));
    const disposed: string[] = [];
    const runtime = createRuntime({
        app: defineApp({
            id: "app",
            providers: [
                provide({
                    token: dependency,
                    lifetime: "transient",
                    create: created,
                    dispose: () => {
                        disposed.push("dependency");
                    },
                }),
                provide({
                    token: dependent,
                    lifetime: "scope",
                    dependencies: [dependency],
                    create: async (ctx) => {
                        expect(await ctx.get(dependency)).toBe(await ctx.get(dependency));
                        return {};
                    },
                    dispose: () => {
                        disposed.push("dependent");
                    },
                }),
            ],
        }),
    });
    const scope = runtime.createExecution();
    await scope.context.get(dependent);
    expect(created).toHaveBeenCalledTimes(1);
    await runtime.dispose();
    expect(disposed).toEqual(["dependent", "dependency"]);
});

test.each([false, true])(
    "supplied owned runtime values are released exactly once (resolved: %s)",
    async (resolve) => {
        const token = createToken<object>("owned-connection"),
            connection = {};
        const dispose = vi.fn();
        const runtime = createRuntime({
            app: defineApp({
                id: "app",
                providers: [
                    provide({
                        token,
                        lifetime: "runtime",
                        value: connection,
                        owned: true,
                        dispose,
                    }),
                ],
            }),
        });
        if (resolve) expect(await runtime.createExecution().context.get(token)).toBe(connection);
        await runtime.dispose();
        await runtime.dispose();
        expect(dispose).toHaveBeenCalledExactlyOnceWith(connection);
    },
);

test.each([false, true])(
    "supplied external values stay external (resolved: %s)",
    async (resolve) => {
        const token = createToken<object>("external-connection"),
            connection = {};
        const dispose = vi.fn();
        const runtime = createRuntime({
            app: defineApp({
                id: "app",
                providers: [provide({ token, lifetime: "runtime", value: connection, dispose })],
            }),
        });
        if (resolve) expect(await runtime.createExecution().context.get(token)).toBe(connection);
        await runtime.dispose();
        await runtime.dispose();
        expect(dispose).not.toHaveBeenCalled();
    },
);

test("unresolved supplied runtime dependents are released before separately initialized dependencies", async () => {
    const dependency = createToken<object>("created-dependency"),
        dependent = createToken<object>("supplied-dependent");
    const disposed: string[] = [];
    const runtime = createRuntime({
        app: defineApp({
            id: "app",
            providers: [
                provide({
                    token: dependent,
                    lifetime: "runtime",
                    value: {},
                    owned: true,
                    dependencies: [dependency],
                    dispose: () => {
                        disposed.push("dependent");
                    },
                }),
                provide({
                    token: dependency,
                    lifetime: "runtime",
                    create: () => ({}),
                    dispose: () => {
                        disposed.push("dependency");
                    },
                }),
            ],
        }),
    });
    await runtime.createExecution().context.get(dependency);
    await runtime.dispose();
    expect(disposed).toEqual(["dependent", "dependency"]);
});
