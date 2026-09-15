import { expect, test, vi, expectTypeOf } from "vite-plus/test";
import {
    createRuntime,
    defineApp,
    defineOperation,
    ExecutionError,
    implementController,
    BaseController,
    type ExecutionContext,
} from "../../src/index";

test("plain data and nested execution use the same scoped dispatcher and policies", async () => {
    const contexts: ExecutionContext[] = [];
    const double = defineOperation({
        id: "double",
        kind: "query",
        handler: (n: number, ctx) => {
            contexts.push(ctx);
            return n * 2;
        },
        policies: [
            (_, ctx) => {
                expect(ctx.bindings.user).toBe("a");
            },
        ],
    });
    const outer = defineOperation({
        id: "outer",
        kind: "query",
        handler: (n: number, ctx) => {
            contexts.push(ctx);
            return ctx.execute(double, n);
        },
    });
    const runtime = createRuntime({ app: defineApp({ id: "test", operations: [double, outer] }) });
    const typedResult = runtime.execute(double, 21, { bindings: { user: "a" } });
    expectTypeOf(typedResult).toEqualTypeOf<Promise<number>>();
    await typedResult;
    contexts.length = 0;
    expect(await runtime.execute(outer, 21, { bindings: { user: "a" } })).toBe(42);
    expect(contexts[0]).toBe(contexts[1]);
    await runtime.dispose();
    await expect(runtime.execute(double, 1)).rejects.toMatchObject({ code: "configuration" });
});

test("policies run before partitioned opt-in cache; invalidation and commands are explicit", async () => {
    const handler = vi.fn((n: number) => n * 2);
    const policy = vi.fn((_: number, ctx: ExecutionContext) => {
        if (ctx.bindings.denied) throw new ExecutionError("denied");
    });
    const query = defineOperation({
        id: "q",
        kind: "query",
        handler,
        policies: [policy],
        cache: { ttlMs: 10000, tags: ["numbers"] },
    });
    const commandHandler = vi.fn(() => 1);
    const command = defineOperation({ id: "c", kind: "command", handler: commandHandler });
    const runtime = createRuntime({ app: defineApp({ id: "app", operations: [query, command] }) });
    await runtime.execute(query, 2, { identity: "a", locale: "en" });
    await runtime.execute(query, 2, { identity: "a", locale: "en" });
    await expect(
        runtime.execute(query, 2, { identity: "a", locale: "en", bindings: { denied: true } }),
    ).rejects.toMatchObject({ code: "denied" });
    await runtime.execute(query, 2, { identity: "b", locale: "en" });
    await runtime.execute(query, 2, { identity: "b", locale: "zh" });
    expect(handler).toHaveBeenCalledTimes(3);
    runtime.invalidate(["numbers"]);
    await runtime.execute(query, 2, { identity: "a", locale: "en" });
    expect(handler).toHaveBeenCalledTimes(4);
    await runtime.execute(command, undefined);
    await runtime.execute(command, undefined);
    expect(commandHandler).toHaveBeenCalledTimes(2);
    await runtime.dispose();
});

test("abort prevents handlers and delayed results from entering cache", async () => {
    let finish!: (n: number) => void;
    const handler = vi.fn(
        () =>
            new Promise<number>((resolve) => {
                finish = resolve;
            }),
    );
    const op = defineOperation({ id: "q", kind: "query", handler, cache: { ttlMs: 1000 } });
    const runtime = createRuntime({ app: defineApp({ id: "app", operations: [op] }) });
    const pre = new AbortController();
    pre.abort();
    await expect(runtime.execute(op, undefined, { signal: pre.signal })).rejects.toMatchObject({
        code: "cancelled",
    });
    expect(handler).not.toHaveBeenCalled();
    const abort = new AbortController();
    const pending = runtime.execute(op, undefined, { signal: abort.signal });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    abort.abort();
    finish(1);
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    const next = runtime.execute(op, undefined);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    finish(2);
    expect(await next).toBe(2);
    await runtime.dispose();
});

test("validation, safe errors and observers preserve results without exposing inputs", async () => {
    const records: Record<string, unknown>[] = [];
    const recorder = {
        record: (_: string, fields = {}) => {
            records.push(fields);
            throw new Error("observer");
        },
    };
    const op = defineOperation<number, number>({
        id: "validated",
        kind: "query",
        input: {
            "~standard": {
                version: 1,
                vendor: "test",
                validate: (n) =>
                    typeof n === "number" ? { value: n } : { issues: [{ message: "secret" }] },
            },
        },
        handler: (n) => n * 2,
    });
    const bad = defineOperation({
        id: "bad",
        kind: "query",
        handler: () => {
            throw new Error("database password");
        },
    });
    const runtime = createRuntime({ app: defineApp({ id: "a", operations: [op, bad] }), recorder });
    expect(await runtime.execute(op, 21)).toBe(42);
    // @ts-expect-error typed input cannot be a string
    await expect(runtime.execute(op, "secret")).rejects.toMatchObject({
        code: "validation",
        status: 400,
    });
    await expect(runtime.execute(bad, undefined)).rejects.toMatchObject({
        code: "failure",
        message: "Execution failed",
        status: 500,
    });
    expect(records.some((r) => r.phase === "complete" && typeof r.durationMs === "number")).toBe(
        true,
    );
    expect(JSON.stringify(records)).not.toContain("secret");
    await runtime.dispose();
});

test("controller bindings instantiate per invocation and cancellation bypasses fallback", async () => {
    let instances = 0;
    const fallback = vi.fn(() => 99);
    class Controller extends BaseController<{ n: number }, number> {
        intentId = "controller";
        constructor() {
            super();
            instances++;
        }
        execute(params: { n: number }, _container: unknown, context?: ExecutionContext) {
            context!.signal.throwIfAborted();
            return params.n;
        }
        override fallback = fallback;
    }
    const op = defineOperation<{ n: number }, number>({ id: "controller", kind: "query" });
    const runtime = createRuntime({
        app: defineApp({
            id: "a",
            operations: [op],
            implementations: [implementController(op, () => new Controller())],
        }),
    });
    expect(await runtime.execute(op, { n: 2 })).toBe(2);
    expect(await runtime.execute(op, { n: 3 })).toBe(3);
    expect(instances).toBe(2);
    expect(fallback).not.toHaveBeenCalled();
    await runtime.dispose();
});

test("controller request state stays separate and late cancellation never falls back", async () => {
    const gates: (() => void)[] = [];
    const fallback = vi.fn(() => "fallback");
    class Stateful extends BaseController<{ user: string }, string> {
        intentId = "state";
        user = "";
        async execute(params: { user: string }) {
            this.user = params.user;
            await new Promise<void>((resolve) => gates.push(resolve));
            return this.user;
        }
        override fallback = fallback;
    }
    const op = defineOperation<{ user: string }, string>({ id: "state", kind: "query" });
    const runtime = createRuntime({
        app: defineApp({
            id: "app",
            operations: [op],
            implementations: [implementController(op, () => new Stateful())],
        }),
    });
    const a = runtime.execute(op, { user: "a" });
    const b = runtime.execute(op, { user: "b" });
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    gates.splice(0).forEach((resolve) => resolve());
    expect(await Promise.all([a, b])).toEqual(["a", "b"]);
    const abort = new AbortController();
    const late = runtime.execute(op, { user: "late" }, { signal: abort.signal });
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    abort.abort();
    gates[0]();
    await expect(late).rejects.toMatchObject({ code: "cancelled" });
    expect(fallback).not.toHaveBeenCalled();
    await runtime.dispose();
});

test("cleanup failures stay private and do not replace a classified business error", async () => {
    const op = defineOperation({
        id: "cleanup",
        kind: "command",
        handler: (_: undefined, ctx) => {
            ctx.onDispose(() => {
                throw new Error("private connection");
            });
            return 1;
        },
    });
    const denied = defineOperation({
        id: "denied",
        kind: "query",
        handler: (_: undefined, ctx) => {
            ctx.onDispose(() => {
                throw new Error("private cleanup");
            });
            throw new ExecutionError("denied");
        },
    });
    const runtime = createRuntime({ app: defineApp({ id: "app", operations: [op, denied] }) });
    await expect(runtime.execute(op, undefined)).rejects.toMatchObject({
        code: "failure",
        message: "Execution failed",
    });
    await expect(runtime.execute(denied, undefined)).rejects.toMatchObject({ code: "denied" });
    await runtime.dispose();
});

test("query cache keys reflect current values when the same input object is reused", async () => {
    const handler = vi.fn((input: { n: number }) => input.n * 2);
    const op = defineOperation({
        id: "mutable-input",
        kind: "query",
        handler,
        cache: { ttlMs: 1000 },
    });
    const runtime = createRuntime({ app: defineApp({ id: "app", operations: [op] }) });
    const input = { n: 1 };
    expect(await runtime.execute(op, input)).toBe(2);
    input.n = 2;
    expect(await runtime.execute(op, input)).toBe(4);
    expect(await runtime.execute(op, input)).toBe(4);
    expect(handler).toHaveBeenCalledTimes(2);
    await runtime.dispose();
});

test("query cache keys reflect nested mutation even through a new outer input", async () => {
    const handler = vi.fn((input: { filter: { n: number } }) => input.filter.n * 2);
    const op = defineOperation({
        id: "nested-input",
        kind: "query",
        handler,
        cache: { ttlMs: 1000 },
    });
    const runtime = createRuntime({ app: defineApp({ id: "app", operations: [op] }) });
    const filter = { n: 1 },
        input = { filter };
    expect(await runtime.execute(op, input)).toBe(2);
    filter.n = 2;
    expect(await runtime.execute(op, input)).toBe(4);
    filter.n = 3;
    expect(await runtime.execute(op, { filter })).toBe(6);
    expect(handler).toHaveBeenCalledTimes(3);
    await runtime.dispose();
});

test("invocation fetch isolates concurrent request capabilities and nested cleanup", async () => {
    const cleaned: string[] = [];
    const nested = defineOperation({
        id: "request-fetch",
        kind: "query",
        capabilities: ["fetch"],
        handler: async (_: undefined, ctx) => {
            ctx.onDispose(() => {
                cleaned.push(ctx.identity!);
            });
            const response = await ctx.fetch("https://app.test/value");
            return [await response.text(), ctx.identity, ctx.locale];
        },
    });
    const outer = defineOperation({
        id: "request-outer",
        kind: "query",
        handler: (_: undefined, ctx) => ctx.execute(nested, undefined),
    });
    const runtime = createRuntime({
        app: defineApp({ id: "requests", operations: [nested, outer] }),
        invocationCapabilities: ["fetch"],
    });
    await expect(runtime.execute(nested, undefined)).rejects.toMatchObject({ code: "capability" });
    const seen: AbortSignal[] = [];
    const invoke = (identity: string, locale: string) =>
        runtime.execute(outer, undefined, {
            identity,
            locale,
            fetch: async (_input, init) => {
                seen.push(init!.signal!);
                await Promise.resolve();
                return new Response(identity);
            },
        });
    expect(await Promise.all([invoke("a", "en"), invoke("b", "zh")])).toEqual([
        ["a", "a", "en"],
        ["b", "b", "zh"],
    ]);
    expect(seen[0]).not.toBe(seen[1]);
    expect(cleaned.sort()).toEqual(["a", "b"]);
    await runtime.dispose();
});
