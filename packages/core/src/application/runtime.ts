import type { Token } from "../dependencies/token";
import { Container } from "../dependencies/container";
import { IntentDispatcher } from "../intents/dispatcher";
import { stableStringify } from "../utils/stable-stringify";
import { generateUuid } from "../utils/uuid";
import { HttpError } from "../http/errors";
import { normalize, configuration } from "./definition";
import {
    ExecutionError,
    type RuntimeOptions,
    type RuntimeHandle,
    type ExecutionHandle,
    type ExecutionContext,
    type Invocation,
    type Operation,
} from "./types";

interface CacheEntry {
    value: unknown;
    expires: number;
    tags: readonly string[];
}
export function createRuntime(options: RuntimeOptions): RuntimeHandle {
    const plan = normalize(options),
        container = new Container(),
        dispatcher = new IntentDispatcher();
    const applicationId = options.app.id,
        runtimeId = generateUuid();
    const active = new Set<ExecutionHandle>(),
        cache = new Map<string, CacheEntry>();
    let closed = false,
        disposal: Promise<void> | undefined,
        cacheVersion = 0;
    for (const provider of plan.providers.values()) container.registerProvider(provider);
    for (const { operation, handler } of plan.implementations.values())
        dispatcher.register({
            intentId: operation.id,
            perform: (intent, _container, context) => handler(intent.params?.input, context!),
        });
    function invalidate(tags: readonly string[]) {
        cacheVersion++;
        for (const [key, entry] of cache)
            if (entry.tags.some((tag) => tags.includes(tag))) cache.delete(key);
        for (const invalidateScope of scopeInvalidators) invalidateScope(tags);
    }
    const scopeInvalidators = new Set<(tags: readonly string[]) => void>();
    const runtime: RuntimeHandle = {
        applicationId,
        runtimeId,
        invalidate,
        async execute(operation, input, invocation) {
            const execution = runtime.createExecution(invocation);
            let output;
            try {
                output = await execution.execute(operation, input);
            } catch (error) {
                // Preserve the classified business failure if resource cleanup also fails.
                await execution.dispose().catch(() => {});
                throw error;
            }
            try {
                await execution.dispose();
            } catch (cause) {
                throw new ExecutionError("failure", undefined, { cause });
            }
            return output;
        },
        createExecution(invocation: Invocation = {}) {
            if (closed) configuration("Runtime is closed");
            invocation = Object.freeze({
                ...invocation,
                bindings: Object.freeze({ ...invocation.bindings }),
            });
            const abort = new AbortController(),
                scope = container.createScope(invocation.bindings);
            const executionId = generateUuid(),
                traceId = invocation.traceId ?? executionId;
            const scopeCache = new Map<string, CacheEntry>();
            const invalidateScope = (tags: readonly string[]) => {
                for (const [key, entry] of scopeCache)
                    if (entry.tags.some((tag) => tags.includes(tag))) scopeCache.delete(key);
            };
            scopeInvalidators.add(invalidateScope);
            const forwardAbort = () => abort.abort(invocation.signal?.reason);
            if (invocation.signal?.aborted) forwardAbort();
            else invocation.signal?.addEventListener("abort", forwardAbort, { once: true });
            let disposed = false,
                disposing: Promise<void> | undefined;
            const running = new Set<Promise<unknown>>();
            const assertActive = () => {
                if (disposed) configuration("Execution is closed");
                if (abort.signal.aborted) throw new ExecutionError("cancelled");
            };
            function record(type: string, fields: Record<string, unknown> = {}) {
                try {
                    const result: unknown = options.recorder?.record(type, {
                        ...fields,
                        applicationId,
                        runtimeId,
                        executionId,
                        traceId,
                    });
                    // A recorder implemented with an async function must not leak a rejection.
                    if (result && typeof (result as Promise<unknown>).then === "function")
                        void Promise.resolve(result).catch(() => {});
                } catch {
                    /* Observers do not own execution outcomes. */
                }
            }
            const context: ExecutionContext = Object.freeze({
                applicationId,
                runtimeId,
                executionId,
                traceId,
                signal: abort.signal,
                container: scope,
                bindings: Object.freeze({ ...invocation.bindings }),
                identity: invocation.identity,
                locale: invocation.locale,
                get: async <T>(token: Token<T>) => {
                    assertActive();
                    return scope.get(token);
                },
                execute: <I, O>(op: Operation<I, O>, input: I) => execution.execute(op, input),
                invalidate,
                record,
                onDispose: (cleanup: () => void | Promise<void>) => {
                    assertActive();
                    scope.onDispose(cleanup);
                },
                fetch: async (
                    input: Parameters<typeof globalThis.fetch>[0],
                    init?: RequestInit,
                ) => {
                    assertActive();
                    const fetch = invocation.fetch ?? options.capabilities?.fetch;
                    if (!fetch) throw new ExecutionError("capability", "Missing capability: fetch");
                    const supplied =
                        init?.signal ??
                        (typeof Request !== "undefined" && input instanceof Request
                            ? input.signal
                            : undefined);
                    const signal = supplied
                        ? AbortSignal.any([abort.signal, supplied])
                        : abort.signal;
                    signal.throwIfAborted();
                    const response = await fetch(input, { ...init, signal });
                    signal.throwIfAborted();
                    return response;
                },
            });
            async function execute<I, O>(operation: Operation<I, O>, input: I): Promise<O> {
                const start = Date.now();
                record("operation", { operationId: operation.id, phase: "start" });
                try {
                    assertActive();
                    if (plan.operations.get(operation.id) !== operation)
                        configuration(`Unknown operation reference: ${operation.id}`);
                    for (const name of operation.capabilities ?? []) {
                        const value =
                            name === "fetch"
                                ? (invocation.fetch ?? options.capabilities?.fetch)
                                : options.capabilities?.[name];
                        if (value == null)
                            throw new ExecutionError("capability", `Missing capability: ${name}`);
                    }
                    let validated = input;
                    if (operation.input) {
                        const result = await operation.input["~standard"].validate(input);
                        if (result.issues) throw new ExecutionError("validation");
                        validated = result.value;
                    }
                    for (const policy of plan.policies.get(operation) ?? []) {
                        assertActive();
                        await policy(validated, context);
                    }
                    assertActive();
                    const policy = operation.cache;
                    const selectedCache = policy?.scope === "execution" ? scopeCache : cache;
                    const key = policy
                        ? stableStringify([
                              operation.id,
                              invocation.identity ?? null,
                              invocation.locale ?? null,
                              policy.key ? policy.key(validated) : validated,
                          ])
                        : undefined;
                    const cached = key ? selectedCache.get(key) : undefined;
                    if (cached && cached.expires > Date.now()) {
                        record("operation", {
                            operationId: operation.id,
                            phase: "complete",
                            cacheHit: true,
                            durationMs: Date.now() - start,
                        });
                        return cached.value as O;
                    }
                    if (key) selectedCache.delete(key);
                    const version = cacheVersion;
                    let output: O = await dispatcher.dispatch<O>(
                        { id: operation.id, params: { input: validated } },
                        scope,
                        context,
                    );
                    assertActive();
                    if (operation.output) {
                        const result = await operation.output["~standard"].validate(output);
                        if (result.issues) throw new ExecutionError("failure");
                        output = result.value;
                    }
                    assertActive();
                    if (key && policy && version === cacheVersion)
                        selectedCache.set(key, {
                            value: output,
                            expires: Date.now() + policy.ttlMs,
                            tags: policy.tags ?? [],
                        });
                    record("operation", {
                        operationId: operation.id,
                        phase: "complete",
                        durationMs: Date.now() - start,
                    });
                    return output;
                } catch (cause) {
                    const error =
                        abort.signal.aborted ||
                        (cause instanceof Error && cause.name === "AbortError")
                            ? new ExecutionError("cancelled", undefined, { cause })
                            : cause instanceof ExecutionError
                              ? cause
                              : cause instanceof HttpError && [400, 403, 404].includes(cause.status)
                                ? new ExecutionError(
                                      cause.status === 404
                                          ? "not_found"
                                          : cause.status === 403
                                            ? "denied"
                                            : "validation",
                                      undefined,
                                      { cause },
                                  )
                                : new ExecutionError("failure", undefined, { cause });
                    record("operation", {
                        operationId: operation.id,
                        phase: "error",
                        code: error.code,
                        durationMs: Date.now() - start,
                    });
                    throw error;
                }
            }
            const execution: ExecutionHandle = {
                context,
                cancel(reason) {
                    abort.abort(reason);
                },
                execute(operation, input) {
                    const promise = execute(operation, input);
                    running.add(promise);
                    void promise.then(
                        () => running.delete(promise),
                        () => running.delete(promise),
                    );
                    return promise;
                },
                dispose() {
                    if (disposing) return disposing;
                    disposed = true;
                    abort.abort();
                    invocation.signal?.removeEventListener("abort", forwardAbort);
                    disposing = (async () => {
                        while (running.size) await Promise.allSettled(running);
                        try {
                            await scope.dispose();
                        } finally {
                            active.delete(execution);
                            scopeInvalidators.delete(invalidateScope);
                            scopeCache.clear();
                        }
                    })();
                    return disposing;
                },
            };
            active.add(execution);
            return execution;
        },
        dispose() {
            if (disposal) return disposal;
            closed = true;
            disposal = (async () => {
                const results = await Promise.allSettled(
                    [...active].map((scope) => scope.dispose()),
                );
                try {
                    await container.dispose();
                } finally {
                    cache.clear();
                }
                const errors = results
                    .filter((result) => result.status === "rejected")
                    .map((result) => result.reason);
                if (errors.length) throw new AggregateError(errors, "Execution cleanup failed");
            })();
            return disposal;
        },
    };
    return runtime;
}
