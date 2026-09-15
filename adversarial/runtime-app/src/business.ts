import {
    createRuntime,
    createToken,
    defineApp,
    defineOperation,
    ExecutionError,
    provide,
} from "@finesoft/front/core";
import { defineEndpoint, type HttpHandlerOptions } from "@finesoft/front/http";
import type { FixtureBindings } from "../config";

const tenantResource = createToken<{ tenant: FixtureBindings["TENANT"]; live: boolean }>(
    "fixture.tenant",
);
const protectedValue = defineOperation({
    id: "fixture.protected",
    kind: "query",
    policies: [
        (_input, ctx) => {
            if (ctx.identity !== "fixture-authorized") throw new ExecutionError("denied");
        },
    ],
    handler: () => "internal-secret",
});
export const inspect = defineOperation({
    id: "fixture.inspect",
    kind: "query",
    handler: async (n: number, ctx) => {
        const resource = await ctx.get(tenantResource);
        return {
            value: n * 2,
            tenant: resource.tenant,
            internal: await ctx.execute(protectedValue, undefined),
        };
    },
});
const stream = defineOperation({
    id: "fixture.stream",
    kind: "query",
    handler: async (_: undefined, ctx) => {
        const resource = await ctx.get(tenantResource);
        let count = 0;
        return new Response(
            new ReadableStream<Uint8Array>(
                {
                    pull(controller) {
                        if (!resource.live)
                            throw new Error("resource released before stream consumption");
                        if (count++ === 0)
                            controller.enqueue(new TextEncoder().encode(`${resource.tenant}:live`));
                        else controller.close();
                    },
                },
                { highWaterMark: 0 },
            ),
            {
                headers: [
                    ["set-cookie", "first=1"],
                    ["set-cookie", "second=2"],
                ],
            },
        );
    },
});
const failure = defineOperation({
    id: "fixture.failure",
    kind: "query",
    handler: () => {
        throw new Error("private internal failure");
    },
});
export function createFixture() {
    const runtime = createRuntime({
        app: defineApp({
            id: "portable-fixture",
            operations: [inspect, protectedValue, stream, failure],
            providers: [
                provide({
                    token: tenantResource,
                    lifetime: "scope",
                    create: (ctx) => {
                        if (typeof ctx.bindings.TENANT !== "string")
                            throw new ExecutionError("validation");
                        return { tenant: ctx.bindings.TENANT, live: true };
                    },
                    dispose: (resource) => {
                        resource.live = false;
                    },
                }),
            ],
        }),
    });
    const options: HttpHandlerOptions = {
        runtime,
        // Test fixture identity only; production uses an authenticated context resolver.
        context: (request) => ({
            identity:
                request.headers.get("x-fixture-authorized") === "yes"
                    ? "fixture-authorized"
                    : undefined,
        }),
        endpoints: [
            defineEndpoint({
                method: "POST",
                path: "/data",
                operation: inspect,
                decode: async (request) => {
                    const input: unknown = await request.json();
                    if (
                        typeof input !== "object" ||
                        input === null ||
                        !("n" in input) ||
                        typeof input.n !== "number"
                    )
                        throw new ExecutionError("validation");
                    return input.n;
                },
                encode: (value) =>
                    Response.json(
                        { value: value.value, tenant: value.tenant },
                        {
                            status: 201,
                            headers: [
                                ["set-cookie", "first=1"],
                                ["set-cookie", "second=2"],
                            ],
                        },
                    ),
            }),
            defineEndpoint({
                method: "GET",
                path: "/stream",
                operation: stream,
                decode: () => undefined,
                encode: (value) => value,
            }),
            defineEndpoint({
                method: "GET",
                path: "/redirect",
                operation: inspect,
                decode: () => 0,
                encode: () => new Response(null, { status: 307, headers: { location: "/data" } }),
            }),
            defineEndpoint({
                method: "GET",
                path: "/failure",
                operation: failure,
                decode: () => undefined,
                encode: () => new Response(null),
            }),
        ],
    };
    return { runtime, options };
}
