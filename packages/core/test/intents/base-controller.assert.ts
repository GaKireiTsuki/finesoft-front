import {
    BaseController,
    type ControllerInput,
    type ControllerFailure,
} from "../../src/intents/base-controller";
import type { ExecutionContext } from "../../src/application/types";

declare const context: ExecutionContext;
type Input = ControllerInput<{ id: number }, { q: string }>;

class CompactController extends BaseController<Input, number> {
    execute({ params, query }: Input) {
        return params.id + query.q.length;
    }
    override fallback({ params, error }: ControllerFailure<Input["params"], Input["query"]>) {
        return params.id + error.message.length;
    }
}
const controller = new CompactController();
const result: Promise<number> = controller.perform({ id: 42 }, context, { q: "test" });
void result;
// @ts-expect-error params remain numeric
void controller.perform({ id: "42" }, context, { q: "test" });
// @ts-expect-error a required query cannot be omitted
void controller.perform({ id: 42 }, context);
// @ts-expect-error query remains separate and typed
void controller.perform({ id: 42 }, context, { q: 42 });
// @ts-expect-error direct results retain the controller result type
const wrongResult: Promise<string> = result;
void wrongResult;

class InvalidFallback extends BaseController<Input, number> {
    execute() {
        return 1;
    }
    // @ts-expect-error fallback must return the same result contract
    override fallback() {
        return "invalid";
    }
}
void InvalidFallback;

class OptionalQuery extends BaseController<
    ControllerInput<{ id: number }, { q?: string }>,
    number
> {
    execute({ params }: ControllerInput<{ id: number }>) {
        return params.id;
    }
}
void new OptionalQuery().perform({ id: 42 }, context);

type ExtendedInput = Input & { tenantId: string };
class UnsupportedInput extends BaseController<ExtendedInput, string> {
    execute({ tenantId }: ExtendedInput) {
        return tenantId.toUpperCase();
    }
}
// @ts-expect-error perform cannot supply additional required top-level fields
void new UnsupportedInput().perform({ id: 42 }, context, { q: "test" });

// Nested business params remain independent of the controller input's top-level fields.
type NestedParams = { params: { id: number }; query: { q: string }; context: ExecutionContext };
class NestedController extends BaseController<
    ControllerInput<NestedParams, { tab: string }>,
    number
> {
    execute({ params, query }: ControllerInput<NestedParams, { tab: string }>) {
        return params.params.id + query.tab.length;
    }
}
void new NestedController().perform({ params: { id: 42 }, query: { q: "" }, context }, context, {
    tab: "one",
});
// @ts-expect-error nested params are not silently flattened
void new NestedController().perform({ id: 42 }, context, { tab: "one" });

// @ts-expect-error the first generic must be the complete controller input
export type RemovedParamsForm = BaseController<{ id: number }, number>;
// @ts-expect-error query belongs to Input, not a third BaseController generic
export type RemovedQueryForm = BaseController<Input, number, { q: string }>;

type StructuralInput = { params: { id: number }; query: { q?: string }; context: ExecutionContext };
class StructuralController extends BaseController<StructuralInput, number> {
    execute({ params }: StructuralInput) {
        return params.id;
    }
}
void new StructuralController().perform({ id: 42 }, context);
