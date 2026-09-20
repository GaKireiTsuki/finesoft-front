import type { BaseController } from "../intents/base-controller";
import type { Operation, OperationHandler, Implementation } from "./types";
export function defineOperation<I = undefined, O = unknown>(
    operation: Operation<I, O>,
): Operation<I, O> {
    return Object.freeze({
        ...operation,
        policies: Object.freeze([...(operation.policies ?? [])]),
        capabilities: Object.freeze([...(operation.capabilities ?? [])]),
        cache:
            operation.cache &&
            Object.freeze({
                ...operation.cache,
                tags: Object.freeze([...(operation.cache.tags ?? [])]),
            }),
    });
}
export function implementOperation<I, O>(
    operation: Operation<I, O>,
    handler: OperationHandler<I, O>,
): Implementation<I, O> {
    return Object.freeze({ operation, handler });
}
/** A fresh controller owns each call; reusable definitions never retain request state. */
export function implementController<I extends Record<string, unknown>, O>(
    operation: Operation<I, O>,
    create: () => BaseController<I, O>,
): Implementation<I, O> {
    return implementOperation(operation, (input, context) => create().perform(input, context));
}
