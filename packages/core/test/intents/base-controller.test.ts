import { expect, test } from "vite-plus/test";
import { BaseController } from "../../src/intents/base-controller";
import { createRuntime } from "../../src/application/runtime";
import { defineApp } from "../../src/application/definition";
import { defineOperation, implementController } from "../../src/application/operation";

test("BaseController uses execution context and cancellation bypasses fallback", async () => {
    class Controller extends BaseController<{ value: number }, number> {
        execute(input: { value: number }) {
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
