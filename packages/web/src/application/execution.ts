import type { ExecutionHandle } from "@finesoft/core";

/** Attach a cancellation boundary to the existing scope without taking its disposal ownership. */
export function bindExecutionCancellation(
    execution: ExecutionHandle,
    signal?: AbortSignal,
): () => void {
    if (!signal) return () => {};
    const cancel = () => execution.cancel(signal.reason);
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
    return () => signal.removeEventListener("abort", cancel);
}
