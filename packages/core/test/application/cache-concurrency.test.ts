import { expect, test, vi } from "vite-plus/test";
import {
    createRuntime,
    defineApp,
    defineOperation,
    ExecutionError,
    type ExecutionContext,
} from "../../src";
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((a, b) => {
        resolve = a;
        reject = b;
    });
    return { promise, resolve, reject };
}

test("runtime caches do not reuse results across invocation bindings with overlapping identities", async () => {
    const handler = vi.fn((_: undefined, context: ExecutionContext) => context.bindings.tenant);
    const query = defineOperation({
        id: "tenant-data",
        kind: "query",
        cache: { scope: "runtime", ttlMs: 10000 },
        handler,
    });
    const runtime = createRuntime({ app: defineApp({ id: "tenants", operations: [query] }) });
    try {
        for (const tenant of ["a", "b", "a"]) {
            const scope = runtime.createExecution({ identity: "member", bindings: { tenant } });
            expect(await scope.execute(query, undefined)).toBe(tenant);
            expect(await scope.execute(query, undefined)).toBe(tenant);
            await scope.dispose();
        }
        expect(handler).toHaveBeenCalledTimes(3);
    } finally {
        await runtime.dispose();
    }
});

test("explicit cache partitions preserve safe cross-execution reuse, policies and invalidation", async () => {
    const handler = vi.fn((_: undefined, context: ExecutionContext) => context.bindings.tenant);
    const query = defineOperation({
        id: "partitioned-data",
        kind: "query",
        cache: {
            ttlMs: 10000,
            partition: (context) => String(context.bindings.tenant),
            tags: ["tenants"],
        },
        policies: [
            (_, context) => {
                if (context.bindings.denied) throw new ExecutionError("denied");
            },
        ],
        handler,
    });
    const runtime = createRuntime({ app: defineApp({ id: "partitioned", operations: [query] }) });
    try {
        for (const tenant of ["a", "b", "a", "b"]) {
            expect(
                await runtime.execute(query, undefined, {
                    identity: "member",
                    bindings: { tenant },
                }),
            ).toBe(tenant);
        }
        expect(handler).toHaveBeenCalledTimes(2);
        await expect(
            runtime.execute(query, undefined, {
                identity: "member",
                bindings: { tenant: "a", denied: true },
            }),
        ).rejects.toMatchObject({ code: "denied" });
        runtime.invalidate(["tenants"]);
        expect(
            await runtime.execute(query, undefined, {
                identity: "member",
                bindings: { tenant: "a" },
            }),
        ).toBe("a");
        expect(handler).toHaveBeenCalledTimes(3);
    } finally {
        await runtime.dispose();
    }
});

test("opaque bindings and invocation fetch implementations stay execution-local without serialization", async () => {
    const opaque: Record<string, unknown> = {};
    opaque.self = opaque;
    const query = defineOperation({
        id: "fetch-data",
        kind: "query",
        cache: { ttlMs: 10000, key: () => "same" },
        handler: async (_: undefined, context) => (await context.fetch("/data")).text(),
    });
    const runtime = createRuntime({ app: defineApp({ id: "opaque", operations: [query] }) });
    try {
        for (const bindings of [undefined, { resource: opaque }]) {
            for (const tenant of ["a", "b"]) {
                expect(
                    await runtime.execute(query, undefined, {
                        identity: "same",
                        bindings,
                        fetch: async () => new Response(tenant),
                    }),
                ).toBe(tenant);
            }
        }
    } finally {
        await runtime.dispose();
    }
});

test("strict default cache keys distinguish undefined, sentinel-shaped objects, null and signed zero", async () => {
    let calls = 0;
    const query = defineOperation({
        id: "key",
        kind: "query",
        cache: { ttlMs: 10000 },
        handler: (_: unknown) => ++calls,
    });
    const runtime = createRuntime({ app: defineApp({ id: "keys", operations: [query] }) });
    const inputs = [
        undefined,
        { $undefined: true },
        null,
        0,
        -0,
        { __proto__: null, nested: undefined },
        { __proto__: null, nested: { $undefined: true } },
        JSON.parse('{"__proto__":{"a":1}}'),
        {},
    ];
    const results = [];
    for (const input of inputs) results.push(await runtime.execute(query, input));
    expect(new Set(results).size).toBe(inputs.length);
    for (let i = 0; i < inputs.length; i++)
        expect(await runtime.execute(query, inputs[i])).toBe(results[i]);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const invalid of [
        new Date(),
        new Map(),
        cyclic,
        NaN,
        () => 0,
        Array(1),
        { [Symbol("x")]: 1 },
    ])
        await expect(runtime.execute(query, invalid)).rejects.toMatchObject({
            code: "configuration",
        });
    expect(calls).toBe(inputs.length);
    await runtime.dispose();
});
test("in-flight queries merge only within an execution after every caller policy; failure permits retry", async () => {
    const pending = deferred<number>();
    let denied = false;
    const policy = vi.fn(() => {
        if (denied) throw new ExecutionError("denied");
    });
    const handler = vi.fn(() => pending.promise);
    const query = defineOperation({
        id: "query",
        kind: "query",
        cache: { ttlMs: 10000 },
        policies: [policy],
        handler,
    });
    const runtime = createRuntime({ app: defineApp({ id: "dedupe", operations: [query] }) });
    const a = runtime.createExecution(),
        b = runtime.createExecution();
    const peers = Array.from({ length: 10 }, () => a.execute(query, undefined)),
        other = b.execute(query, undefined);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    expect(policy).toHaveBeenCalledTimes(11);
    denied = true;
    await expect(a.execute(query, undefined)).rejects.toMatchObject({ code: "denied" });
    pending.resolve(42);
    expect(await Promise.all([...peers, other])).toEqual(Array(11).fill(42));
    await runtime.dispose();
    const fail = vi.fn().mockRejectedValueOnce(Error("no")).mockResolvedValue(2);
    const retry = defineOperation({
        id: "retry",
        kind: "query",
        cache: { ttlMs: 10000 },
        handler: fail,
    });
    const owner = createRuntime({ app: defineApp({ id: "retry", operations: [retry] }) });
    const execution = owner.createExecution();
    await expect(execution.execute(retry, undefined)).rejects.toMatchObject({ code: "failure" });
    expect(await execution.execute(retry, undefined)).toBe(2);
    await owner.dispose();
});
test("invalidation detaches pending work and prevents old completion from refilling bounded caches", async () => {
    const pending = [deferred<string>(), deferred<string>()];
    let calls = 0;
    const query = defineOperation({
        id: "query",
        kind: "query",
        cache: { ttlMs: 10000, tags: ["items"] },
        handler: () => pending[calls++].promise,
    });
    const runtime = createRuntime({ app: defineApp({ id: "generation", operations: [query] }) });
    const execution = runtime.createExecution();
    const old = execution.execute(query, undefined);
    await vi.waitFor(() => expect(calls).toBe(1));
    runtime.invalidate(["items"]);
    const fresh = execution.execute(query, undefined);
    await vi.waitFor(() => expect(calls).toBe(2));
    pending[1].resolve("fresh");
    expect(await fresh).toBe("fresh");
    pending[0].resolve("old");
    expect(await old).toBe("old");
    expect(await execution.execute(query, undefined)).toBe("fresh");
    expect(calls).toBe(2);
    await runtime.dispose();
});
test("completed runtime and execution caches honor capacity and least-recently-used ordering", async () => {
    for (const scope of ["runtime", "execution"] as const) {
        const handler = vi.fn((n: number) => n);
        const query = defineOperation({
            id: "query",
            kind: "query",
            cache: { ttlMs: 10000, scope },
            handler,
        });
        const runtime = createRuntime({
            app: defineApp({ id: "capacity", operations: [query] }),
            cacheCapacity: 2,
        });
        const execution = runtime.createExecution();
        await execution.execute(query, 1);
        await execution.execute(query, 2);
        await execution.execute(query, 1);
        await execution.execute(query, 3);
        await execution.execute(query, 2);
        expect(handler).toHaveBeenCalledTimes(4);
        await runtime.dispose();
    }
});

test.each([
    [401, "unauthenticated"],
    [409, "conflict"],
    [429, "rate_limited"],
    [502, "failure"],
] as const)("upstream HTTP %s maps only to safe public error %s", async (status, code) => {
    const { HttpError } = await import("../../src");
    const operation = defineOperation({
        id: "upstream",
        kind: "query",
        handler: () => {
            throw new HttpError(status, "private diagnostic", "credential=secret");
        },
    });
    const runtime = createRuntime({
        app: defineApp({ id: "safe-errors", operations: [operation] }),
    });
    const error = await runtime.execute(operation, undefined).catch((error) => error);
    expect(error).toMatchObject({ code, status: status === 502 ? 500 : status });
    expect(error.message).not.toContain("private");
    expect(error.message).not.toContain("secret");
    await runtime.dispose();
});
test("asynchronous invalidation observers cannot produce unhandled failure or prevent other observers", async () => {
    const runtime = createRuntime({ app: defineApp({ id: "observers" }) });
    const listener = vi.fn();
    runtime.onInvalidate(async () => {
        throw Error("observer");
    });
    runtime.onInvalidate(listener);
    runtime.invalidate(["changed"]);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledWith(["changed"]);
    await runtime.dispose();
});
