import { expect, test, vi } from "vite-plus/test";
import { createRuntime, defineApp, defineOperation, createToken, provide } from "@finesoft/core";
import { defineEndpoint } from "../src/http";
import { createHttpHandler, runManagedTask } from "../src/worker";

test("the HTTP owner initializes once during the first Worker request and isolates later bindings", async () => {
    const operation = defineOperation({
        id: "tenant",
        kind: "query",
        handler: (_: undefined, ctx) => ctx.bindings.tenant,
    });
    let runtime: ReturnType<typeof createRuntime> | undefined;
    const initialize = vi.fn(() => {
        runtime = createRuntime({ app: defineApp({ id: "lazy-worker", operations: [operation] }) });
        return {
            runtime,
            endpoints: [
                defineEndpoint({
                    method: "GET",
                    path: "/",
                    operation,
                    decode: () => undefined,
                    encode: (value) => Response.json(value),
                }),
            ],
        };
    });
    const handler = createHttpHandler(initialize);
    expect(initialize).not.toHaveBeenCalled();
    const responses = await Promise.all(
        ["first", "second"].map((tenant) =>
            handler.fetch(new Request("https://worker/"), { tenant }),
        ),
    );
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
        "first",
        "second",
    ]);
    expect(initialize).toHaveBeenCalledTimes(1);
    await runtime!.dispose();
});

test("managed task owns a separate scope through host completion, independently of response cancellation", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const events: string[] = [];
    const token = createToken<{ name: string }>("resource");
    const operation = defineOperation({
        id: "task",
        kind: "command",
        handler: async (_: undefined, ctx) => {
            await ctx.get(token);
            runManagedTask(ctx, async (task) => {
                expect(task.traceId).toBe(ctx.traceId);
                const resource = await task.get(token);
                await gate;
                events.push(`task:${resource.name}:${task.signal.aborted}`);
            });
            return new Response("ok");
        },
    });
    const runtime = createRuntime({
        app: defineApp({
            id: "tasks",
            operations: [operation],
            providers: [
                provide({
                    token,
                    lifetime: "scope",
                    create: (ctx) => ({ name: String(ctx.bindings.name) }),
                    dispose: (value) => {
                        events.push(`dispose:${value.name}`);
                    },
                }),
            ],
        }),
    });
    const worker = createHttpHandler({
        runtime,
        endpoints: [
            defineEndpoint({
                method: "GET",
                path: "/",
                operation,
                decode: () => undefined,
                encode: (value) => value,
            }),
        ],
    });
    const pending: Promise<unknown>[] = [];
    const host = {
        count: 0,
        waitUntil(work: Promise<unknown>) {
            this.count++;
            pending.push(work);
        },
    };
    const response = await worker.fetch(
        new Request("https://example.com"),
        { name: "first" },
        host,
    );
    await response.body!.cancel();
    expect(events).toEqual(["dispose:first"]);
    expect(host.count).toBe(1);
    finish();
    await Promise.all(pending);
    expect(events).toEqual(["dispose:first", "task:first:false", "dispose:first"]);
    const unsupported = await worker.fetch(new Request("https://example.com"), { name: "second" });
    expect(unsupported.status).toBe(503);
    expect(await unsupported.text()).toContain("Required capability unavailable");
    expect(events.at(-1)).toBe("dispose:second");
    await runtime.dispose();
});
