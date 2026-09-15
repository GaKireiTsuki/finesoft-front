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
