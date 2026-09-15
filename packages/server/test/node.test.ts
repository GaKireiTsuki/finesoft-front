import { expect, test, vi } from "vite-plus/test";
import { format } from "node:util";
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

test.each(["default", "throw", "reject"] as const)(
    "%s diagnostics omit arbitrary task/reporter payloads",
    async (mode) => {
        const markers = [
            "body-marker",
            "cookie-marker",
            "credential-marker",
            "page-marker",
            "page-data-marker",
            "message-marker",
            "cause-marker",
            "reporter-marker",
        ];
        const taskFailure = Object.assign(
            new Error("message-marker", { cause: new Error("cause-marker") }),
            {
                requestBody: "body-marker",
                cookie: "cookie-marker",
                credentials: "credential-marker",
                page: { html: "page-marker", serverData: { private: "page-data-marker" } },
            },
        );
        const reporterFailure = Object.assign(new Error("reporter-marker"), {
            request: taskFailure,
        });
        const observed: unknown[] = [];
        const diagnostics: unknown[][] = [];
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation((...values: unknown[]) => {
                diagnostics.push(values);
            });
        const operation = defineOperation({
            id: "diagnostics",
            kind: "command",
            handler: (_: undefined, ctx) => {
                runManagedTask(ctx, () => {
                    throw taskFailure;
                });
                return "ok";
            },
        });
        const runtime = createRuntime({
            app: defineApp({ id: "diagnostics", operations: [operation] }),
        });
        const onTaskError =
            mode === "default"
                ? undefined
                : (error: unknown) => {
                      observed.push(error);
                      if (mode === "throw") throw reporterFailure;
                      return Promise.reject(reporterFailure);
                  };
        let host: Awaited<ReturnType<typeof startNodeHandler>> | undefined;
        try {
            host = await startNodeHandler({
                runtime,
                port: 0,
                hostname: "127.0.0.1",
                onTaskError,
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
            expect(await (await fetch(`http://127.0.0.1:${address.port}`)).text()).toBe("ok");
            await host.dispose();
            expect(diagnostics).toHaveLength(1);
            const formatted = diagnostics.map((values) => format(...values)).join("\n");
            for (const marker of markers) expect(formatted).not.toContain(marker);
            expect(diagnostics[0]).toEqual([
                "[Node managed task]",
                mode === "default"
                    ? { code: "failure" }
                    : { code: "failure", reporterFailed: true },
            ]);
            expect(observed).toEqual(mode === "default" ? [] : [taskFailure]);
        } finally {
            await host?.dispose();
            await runtime.dispose();
            consoleError.mockRestore();
        }
    },
);

test("the explicit task reporter retains the original failure and is awaited by host shutdown", async () => {
    const failure = new Error("explicit observer payload");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let begin!: () => void;
    const begun = new Promise<void>((resolve) => {
        begin = resolve;
    });
    const events: string[] = [];
    const operation = defineOperation({
        id: "await-reporter",
        kind: "command",
        handler: (_: undefined, ctx) => {
            runManagedTask(ctx, () => {
                throw failure;
            });
            return "ok";
        },
    });
    const runtime = createRuntime({ app: defineApp({ id: "reporter", operations: [operation] }) });
    const host = await startNodeHandler({
        runtime,
        port: 0,
        hostname: "127.0.0.1",
        onTaskError: async (error) => {
            expect(error).toBe(failure);
            events.push("reporter-start");
            begin();
            await gate;
            events.push("reporter-end");
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
    await (await fetch(`http://127.0.0.1:${address.port}`)).text();
    await begun;
    const closing = host.dispose().then(() => {
        events.push("host-disposed");
    });
    await new Promise((resolve) => setImmediate(resolve));
    try {
        expect(events).toEqual(["reporter-start"]);
    } finally {
        release();
        await closing;
    }
    expect(events).toEqual(["reporter-start", "reporter-end", "host-disposed"]);
});
