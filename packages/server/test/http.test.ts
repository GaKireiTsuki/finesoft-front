import { expect, test } from "vite-plus/test";
import {
    createRuntime,
    defineApp,
    defineOperation,
    createToken,
    provide,
    ExecutionError,
} from "@finesoft/core";
import { createHttpHandler, defineEndpoint } from "../src/http";

test("explicit projection, context, protected nested calls and deterministic HTTP errors", async () => {
    const inner = defineOperation({
        id: "inner",
        kind: "query",
        policies: [
            (_input, ctx) => {
                if (ctx.identity !== "allowed") throw new ExecutionError("denied");
            },
        ],
        handler: () => "secret",
    });
    const op = defineOperation({
        id: "data",
        kind: "query",
        handler: async (n: number, ctx) => ({
            n,
            secret: await ctx.execute(inner, undefined),
            tenant: ctx.bindings.tenant,
        }),
    });
    const runtime = createRuntime({ app: defineApp({ id: "http", operations: [op, inner] }) });
    const handler = createHttpHandler({
        runtime,
        context: (req) => ({ identity: req.headers.get("identity") ?? undefined }),
        endpoints: [
            defineEndpoint({
                method: "POST",
                path: "/data",
                operation: op,
                decode: async (req) => {
                    const body = await req.json();
                    if (typeof body.n !== "number") throw new Error("bad secret input");
                    return body.n;
                },
                encode: (value) =>
                    Response.json(
                        { n: value.n, tenant: value.tenant },
                        {
                            status: 201,
                            headers: [
                                ["set-cookie", "a=1"],
                                ["set-cookie", "b=2"],
                            ],
                        },
                    ),
            }),
        ],
    });
    const response = await handler(
        new Request("https://example.com/data", {
            method: "POST",
            body: '{"n":3}',
            headers: { identity: "allowed" },
        }),
        { tenant: "first" },
    );
    expect(response.status).toBe(201);
    expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(await response.json()).toEqual({ n: 3, tenant: "first" });
    const denied = await handler(
        new Request("https://example.com/data", { method: "POST", body: '{"n":3}' }),
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: { code: "denied", message: "Access denied" } });
    const bad = await handler(
        new Request("https://example.com/data", { method: "POST", body: '{"n":"x"}' }),
    );
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain("secret");
    expect((await handler(new Request("https://example.com/data"))).status).toBe(405);
    expect((await handler(new Request("https://example.com/inner"))).status).toBe(404);
    await runtime.dispose();
});

test.each(["complete", "cancel", "error", "abort"] as const)(
    "stream owns resources until %s after response creation",
    async (mode) => {
        let disposed = false;
        let streamController!: ReadableStreamDefaultController<Uint8Array>;
        const token = createToken<{ live: boolean }>("resource");
        const op = defineOperation({
            id: "stream",
            kind: "query",
            handler: async (_: undefined, ctx) => {
                const value = await ctx.get(token);
                return new Response(
                    new ReadableStream<Uint8Array>({
                        start(c) {
                            streamController = c;
                        },
                        pull(c) {
                            if (!value.live) c.error(new Error("disposed early"));
                        },
                    }),
                );
            },
        });
        const runtime = createRuntime({
            app: defineApp({
                id: "stream",
                operations: [op],
                providers: [
                    provide({
                        token,
                        lifetime: "scope",
                        create: () => ({ live: true }),
                        dispose: (value) => {
                            value.live = false;
                            disposed = true;
                        },
                    }),
                ],
            }),
        });
        const handler = createHttpHandler({
            runtime,
            endpoints: [
                defineEndpoint({
                    method: "GET",
                    path: "/",
                    operation: op,
                    decode: () => undefined,
                    encode: (r) => r,
                }),
            ],
        });
        const abort = new AbortController();
        const response = await handler(
            new Request("https://example.com", { signal: abort.signal }),
        );
        expect(disposed).toBe(false);
        if (mode === "complete") {
            streamController.enqueue(new TextEncoder().encode("ok"));
            streamController.close();
            expect(await response.text()).toBe("ok");
        }
        if (mode === "cancel") await response.body!.cancel();
        if (mode === "error") {
            streamController.error(new Error("read failed"));
            await expect(response.text()).rejects.toThrow("read failed");
        }
        if (mode === "abort") {
            abort.abort();
            await expect(response.text()).rejects.toThrow();
        }
        expect(disposed).toBe(true);
        await runtime.dispose();
    },
);
