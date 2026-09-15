import { expect, test } from "vite-plus/test";
import { createRuntime, defineApp, defineOperation, createToken, provide } from "@finesoft/core";
import { createHttpHandler, defineEndpoint, runManagedTask } from "../src/http";
import { startNodeHandler } from "../src/node";

test("Node host drains managed task resources before runtime teardown and closes the listener", async () => {
    let complete!: () => void;
    const gate = new Promise<void>((resolve) => {
        complete = resolve;
    });
    const events: string[] = [];
    const resource = createToken<object>("resource");
    const operation = defineOperation({
        id: "task",
        kind: "command",
        handler: (_: undefined, ctx) => {
            runManagedTask(ctx, async (task) => {
                await task.get(resource);
                await gate;
                events.push("task-done");
            });
            return "ok";
        },
    });
    const runtime = createRuntime({
        app: defineApp({
            id: "node",
            operations: [operation],
            providers: [
                provide({
                    token: resource,
                    lifetime: "scope",
                    create: () => ({}),
                    dispose: () => {
                        events.push("task-cleanup");
                    },
                }),
            ],
        }),
    });
    const host = await startNodeHandler({
        runtime,
        port: 0,
        hostname: "127.0.0.1",
        handler: createHttpHandler({
            runtime,
            endpoints: [
                defineEndpoint({
                    method: "GET",
                    path: "/",
                    operation,
                    decode: () => undefined,
                    encode: (value) => new Response(value),
                }),
            ],
        }),
    });
    const address = host.server.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    try {
        expect(await (await fetch(`http://127.0.0.1:${address.port}/`)).text()).toBe("ok");
        const closing = host.dispose();
        expect(events).toEqual([]);
        complete();
        await closing;
        await host.dispose();
        expect(events).toEqual(["task-done", "task-cleanup"]);
        expect(host.server.listening).toBe(false);
        await expect(runtime.execute(operation, undefined)).rejects.toThrow();
    } finally {
        complete();
        await host.dispose();
    }
});

test("disconnect during a gated encoder does not finish host disposal early", async () => {
    let begin!: () => void;
    const begun = new Promise<void>((resolve) => {
        begin = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const events: string[] = [];
    const token = createToken<{ live: boolean }>("encoder");
    const operation = defineOperation({
        id: "encode",
        kind: "query",
        handler: (_: undefined, ctx) => ctx.get(token),
    });
    const runtime = createRuntime({
        app: defineApp({
            id: "encoder",
            operations: [operation],
            providers: [
                provide({
                    token,
                    lifetime: "scope",
                    create: () => ({ live: true }),
                    dispose: (value) => {
                        value.live = false;
                        events.push("dispose");
                    },
                }),
            ],
        }),
    });
    const host = await startNodeHandler({
        runtime,
        port: 0,
        hostname: "127.0.0.1",
        handler: createHttpHandler({
            runtime,
            endpoints: [
                defineEndpoint({
                    method: "GET",
                    path: "/",
                    operation,
                    decode: () => undefined,
                    encode: async (value) => {
                        events.push("encode-start");
                        begin();
                        await gate;
                        events.push(`encode-end:${value.live}`);
                        return new Response("ok");
                    },
                }),
            ],
        }),
    });
    const address = host.server.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    const abort = new AbortController();
    const request = fetch(`http://127.0.0.1:${address.port}`, { signal: abort.signal }).catch(
        () => {},
    );
    await begun;
    abort.abort();
    await request;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const closing = host.dispose().then(() => {
        events.push("host-disposed");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    try {
        expect(events).toEqual(["encode-start"]);
    } finally {
        release();
        await closing;
        await new Promise((resolve) => setImmediate(resolve));
    }
    expect(events).toEqual(["encode-start", "encode-end:true", "dispose", "host-disposed"]);
});

test.each(["callback", "cleanup", "both"] as const)(
    "Node reports managed %s failure and still drains cleanup",
    async (mode) => {
        const failures: unknown[] = [];
        let cleaned = false;
        const callbackFailure = new Error("managed callback failed");
        const cleanupFailure = new Error("managed cleanup failed");
        const operation = defineOperation({
            id: "failing-task",
            kind: "command",
            handler: (_: undefined, ctx) => {
                runManagedTask(ctx, (task) => {
                    task.onDispose(() => {
                        cleaned = true;
                        if (mode !== "callback") throw cleanupFailure;
                    });
                    if (mode !== "cleanup") throw callbackFailure;
                });
                return "ok";
            },
        });
        const runtime = createRuntime({
            app: defineApp({ id: "failure-reporting", operations: [operation] }),
        });
        const host = await startNodeHandler({
            runtime,
            port: 0,
            hostname: "127.0.0.1",
            onTaskError: (error) => {
                failures.push(error);
            },
            handler: createHttpHandler({
                runtime,
                endpoints: [
                    defineEndpoint({
                        method: "GET",
                        path: "/",
                        operation,
                        decode: () => undefined,
                        encode: (value) => new Response(value),
                    }),
                ],
            }),
        });
        const address = host.server.address();
        if (!address || typeof address === "string") throw new Error("missing address");
        try {
            expect(await (await fetch(`http://127.0.0.1:${address.port}`)).text()).toBe("ok");
        } finally {
            await host.dispose();
        }
        expect(cleaned).toBe(true);
        expect(failures).toHaveLength(1);
        const messages = (error: unknown): string =>
            error instanceof AggregateError
                ? error.errors.map(messages).join(" ")
                : error instanceof Error
                  ? `${error.message} ${error.cause ? messages(error.cause) : ""}`
                  : String(error);
        if (mode !== "cleanup") expect(messages(failures[0])).toContain(callbackFailure.message);
        if (mode !== "callback") expect(messages(failures[0])).toContain(cleanupFailure.message);
    },
);
