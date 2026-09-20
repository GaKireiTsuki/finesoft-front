import { expect, test } from "vite-plus/test";
import {
    BaseController,
    type ControllerInput,
    type ControllerFailure,
} from "../../src/intents/base-controller";
import { createRuntime } from "../../src/application/runtime";
import { defineApp } from "../../src/application/definition";
import {
    defineOperation,
    implementController,
    implementOperation,
} from "../../src/application/operation";

test("BaseController uses execution context and cancellation bypasses fallback", async () => {
    class Controller extends BaseController<ControllerInput<{ value: number }>, number> {
        execute({ params: input }: { params: { value: number } }) {
            if (input.value < 0) throw Error("bad");
            return input.value;
        }
        fallback() {
            return 99;
        }
    }
    const op = defineOperation<{ value: number }, number>({ id: "controller", kind: "query" });
    const runtime = createRuntime({
        app: defineApp({
            id: "test",
            operations: [op],
            implementations: [implementController(op, () => new Controller())],
        }),
    });
    expect(await runtime.execute(op, { value: 2 })).toBe(2);
    expect(await runtime.execute(op, { value: -1 })).toBe(99);
    const execution = runtime.createExecution();
    execution.cancel();
    await expect(execution.execute(op, { value: -1 })).rejects.toMatchObject({ code: "cancelled" });
    await execution.dispose();
    await runtime.dispose();
});

test("compact input contracts preserve params, query and context through fallback", async () => {
    type Input = ControllerInput<{ id: number }, { q: string }>;
    class Controller extends BaseController<Input, string> {
        execute({ params, query }: Input) {
            if (params.id < 0) throw Error(query.q);
            return `${params.id}:${query.q}`;
        }
        override fallback({
            params,
            query,
            context,
            error,
        }: ControllerFailure<Input["params"], Input["query"]>) {
            expect(context.signal.aborted).toBe(false);
            expect(error.message).toBe(query.q);
            return `${params.id}:fallback:${query.q}`;
        }
    }
    const op = defineOperation<{ id: number }, string>({ id: "compact", kind: "query" });
    const runtime = createRuntime({
        app: defineApp({
            id: "compact",
            operations: [op],
            implementations: [
                implementOperation(op, (params, context) =>
                    new Controller().perform(params, context, { q: "search" }),
                ),
            ],
        }),
    });
    try {
        expect(await runtime.execute(op, { id: 42 })).toBe("42:search");
        expect(await runtime.execute(op, { id: -1 })).toBe("-1:fallback:search");
    } finally {
        await runtime.dispose();
    }
});
