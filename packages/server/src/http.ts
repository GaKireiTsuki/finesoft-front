import {
    ExecutionError,
    type ExecutionContext,
    type ExecutionHandle,
    type Invocation,
    type Operation,
    type RuntimeHandle,
} from "@finesoft/core";

export interface HttpEndpoint {
    readonly method: string;
    readonly path: string;
    readonly respond: (request: Request, execution: ExecutionHandle) => Promise<Response>;
}
export interface EndpointOptions<I, O> {
    readonly method: string;
    /** Exact URL pathname. Query/body validation belongs in decode. */
    readonly path: string;
    readonly operation: Operation<I, O>;
    readonly decode: (request: Request, context: ExecutionContext) => I | Promise<I>;
    /** Explicit public projection. No automatic serialization of operation results. */
    readonly encode: (output: O, context: ExecutionContext) => Response | Promise<Response>;
}
export function defineEndpoint<I, O>(options: EndpointOptions<I, O>): HttpEndpoint {
    const { method, path, operation, decode, encode } = options;
    if (
        !/^[A-Za-z]+$/.test(method) ||
        !path.startsWith("/") ||
        path.includes("?") ||
        typeof decode !== "function" ||
        typeof encode !== "function"
    )
        throw new ExecutionError("configuration");
    return Object.freeze({
        method: method.toUpperCase(),
        path,
        async respond(request: Request, execution: ExecutionHandle) {
            let input: I;
            try {
                input = await decode(request, execution.context);
            } catch (error) {
                throw error instanceof ExecutionError
                    ? error
                    : new ExecutionError("validation", undefined, { cause: error });
            }
            const output = await execution.execute(operation, input);
            const response = await encode(output, execution.context);
            if (!(response instanceof Response)) throw new ExecutionError("failure");
            return response;
        },
    });
}
export interface HttpHost {
    /** The host must retain the supplied promise, including its resource cleanup. */
    waitUntil(promise: Promise<unknown>): void;
    /** Retain the complete invocation, including encoding, body consumption/cancel and cleanup. */
    trackRequest?(completion: Promise<void>): void;
}
export interface HttpHandlerOptions {
    readonly runtime: RuntimeHandle;
    readonly endpoints: readonly HttpEndpoint[];
    /** Identity/locale must be derived from trusted authentication, not arbitrary client claims. */
    readonly context?: (
        request: Request,
        bindings: Readonly<Record<string, unknown>>,
    ) => Omit<Invocation, "signal"> | Promise<Omit<Invocation, "signal">>;
}
export type HttpHandler = (
    request: Request,
    bindings?: Readonly<Record<string, unknown>>,
    host?: HttpHost,
) => Promise<Response>;
export type ManagedTask = (context: ExecutionContext) => void | Promise<void>;
const TASK_BINDING = "__finesoftManagedTask";
/** Run work in its own execution scope. Use the supplied task context to acquire resources.
 * Its signal is independent of response cancellation; cleanup is part of host waitUntil.
 * The callback must await all its work and may not return streams or retain request resources.
 */
export function runManagedTask(context: ExecutionContext, task: ManagedTask): void {
    const schedule = context.bindings[TASK_BINDING];
    if (typeof schedule !== "function") throw new ExecutionError("capability");
    schedule(task);
}
function publicError(error: unknown): Response {
    const classified = error instanceof ExecutionError ? error : new ExecutionError("failure");
    // Custom/internal error messages are deliberately not exposed by this transport.
    const safe = new ExecutionError(classified.code);
    return Response.json(
        { error: { code: safe.code, message: safe.message } },
        { status: safe.status },
    );
}
export function createHttpHandler(options: HttpHandlerOptions): HttpHandler {
    const routes = new Map<string, Map<string, HttpEndpoint>>();
    for (const endpoint of options.endpoints) {
        const methods = routes.get(endpoint.path) ?? new Map<string, HttpEndpoint>();
        if (methods.has(endpoint.method)) throw new ExecutionError("configuration");
        methods.set(endpoint.method, endpoint);
        routes.set(endpoint.path, methods);
    }
    return async (request, bindings = {}, host) => {
        const methods = routes.get(new URL(request.url).pathname);
        if (!methods) return publicError(new ExecutionError("not_found"));
        const endpoint = methods.get(request.method);
        if (!endpoint)
            return Response.json(
                { error: { code: "method_not_allowed", message: "Method not allowed" } },
                { status: 405, headers: { Allow: [...methods.keys()].join(", ") } },
            );
        const abort = new AbortController();
        const signal = AbortSignal.any([request.signal, abort.signal]);
        let execution: ExecutionHandle | undefined;
        let acceptingTasks = true;
        let complete!: () => void;
        const completion = new Promise<void>((resolve) => {
            complete = resolve;
        });
        let responseOwnsCompletion = false;
        try {
            host?.trackRequest?.(completion);
            const invocation = await options.context?.(request, bindings);
            const requestBindings = { ...bindings, ...invocation?.bindings };
            // Callback and bindings are created for every request; the runtime captures no host.
            const schedule = (task: ManagedTask) => {
                signal.throwIfAborted();
                if (!host || !acceptingTasks) throw new ExecutionError("capability");
                const taskExecution = options.runtime.createExecution({
                    ...invocation,
                    traceId: execution!.context.traceId,
                    bindings: { ...requestBindings, [TASK_BINDING]: undefined },
                });
                let registered = false;
                const work = Promise.resolve().then(async () => {
                    let failed = false;
                    let taskError: unknown;
                    try {
                        if (registered) await task(taskExecution.context);
                    } catch (error) {
                        failed = true;
                        taskError = error;
                    }
                    try {
                        await taskExecution.dispose();
                    } catch (error) {
                        if (failed)
                            throw new AggregateError(
                                [taskError, error],
                                "Managed task and cleanup failed",
                            );
                        throw error;
                    }
                    if (failed) throw taskError;
                });
                // A synchronous host rejection skips the callback but still observes scope cleanup.
                try {
                    host.waitUntil(work);
                    registered = true;
                } catch (error) {
                    void work.catch(() => {});
                    throw new ExecutionError("capability", undefined, { cause: error });
                }
            };
            execution = options.runtime.createExecution({
                ...invocation,
                signal,
                bindings: { ...requestBindings, [TASK_BINDING]: schedule },
            });
            const response = await endpoint.respond(request, execution);
            if (signal.aborted) {
                await response.body?.cancel(signal.reason);
                throw new ExecutionError("cancelled");
            }
            acceptingTasks = false;
            const ownedResponse = await ownResponse(response, execution, abort, signal, complete);
            responseOwnsCompletion = true;
            return ownedResponse;
        } catch (error) {
            acceptingTasks = false;
            try {
                await execution?.dispose();
            } catch {
                /* Cleanup details remain private. */
            }
            return publicError(signal.aborted ? new ExecutionError("cancelled") : error);
        } finally {
            if (!responseOwnsCompletion) complete();
        }
    };
}
/** The body reader, not Response creation, ends the execution. No prefetch into our wrapper. */
async function ownResponse(
    response: Response,
    execution: ExecutionHandle,
    abort: AbortController,
    signal: AbortSignal,
    complete: () => void,
): Promise<Response> {
    if (!response.body) {
        await execution.dispose();
        complete();
        return response;
    }
    const reader = response.body.getReader();
    let finished: Promise<void> | undefined;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    // Set the terminal promise before calling reader.cancel: that call can settle a pending read
    // immediately, while the source's asynchronous cancellation is still using scoped resources.
    const finish = (cancellation?: { reason: unknown }) => {
        if (finished) return finished;
        finished = Promise.resolve().then(async () => {
            signal.removeEventListener("abort", onAbort);
            try {
                if (cancellation) await reader.cancel(cancellation.reason);
            } catch {
                /* Cancellation details are private; scope cleanup must still complete. */
            }
            try {
                await execution.dispose();
            } catch {
                /* Resource cleanup failures are not public body data. */
            } finally {
                complete();
            }
        });
        return finished;
    };
    const onAbort = () => {
        void finish({ reason: signal.reason }).then(() =>
            controller.error(new ExecutionError("cancelled")),
        );
    };
    const body = new ReadableStream<Uint8Array>(
        {
            start(c) {
                controller = c;
                signal.addEventListener("abort", onAbort, { once: true });
                if (signal.aborted) onAbort();
            },
            async pull(c) {
                try {
                    const result = await reader.read();
                    if (signal.aborted) {
                        await finish();
                        c.error(new ExecutionError("cancelled"));
                        return;
                    }
                    if (result.done) {
                        await finish();
                        c.close();
                    } else c.enqueue(result.value);
                } catch (error) {
                    await finish();
                    c.error(error);
                }
            },
            async cancel(reason) {
                signal.removeEventListener("abort", onAbort);
                const completion = finish({ reason });
                abort.abort(reason);
                await completion;
            },
        },
        { highWaterMark: 0 },
    );
    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}
