import type { Token } from "../dependencies/token";
import { Container } from "../dependencies/container";
import { HttpError } from "../http/errors";
import { LruMap } from "../utils/lru-map";
import { generateUuid } from "../utils/uuid";
import { normalize, configuration } from "./definition";
import {
    ExecutionError,
    executionErrorFromHttp,
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

interface InFlightEntry {
    readonly promise: Promise<unknown>;
    readonly runtimeGeneration: number;
    readonly scopeGeneration: number;
}

function afterSettled<T>(promise: Promise<T>, callback: () => void): void {
    void promise.then(callback, callback);
}

const MAX_CACHE_KEY_DEPTH = 50;

/**
 * Cache identity only accepts JSON data.  A permissive serializer silently
 * aliases Dates, class instances, cycles, and over-deep values, which makes a
 * query cache return the wrong business result.  `undefined` is intentional
 * input data and therefore gets a distinct explicit representation.
 */
function encodeCacheIdentity(value: unknown): string {
    const seen = new Set<object>();
    const encode = (current: unknown, depth: number): unknown => {
        if (depth > MAX_CACHE_KEY_DEPTH)
            throw new ExecutionError("configuration", "Cache input exceeds maximum depth");
        if (current === undefined) return ["undefined"];
        if (current === null) return ["null"];
        if (typeof current === "string" || typeof current === "boolean")
            return [typeof current, current];
        if (typeof current === "number") {
            if (!Number.isFinite(current))
                throw new ExecutionError(
                    "configuration",
                    "Cache input contains a non-finite number",
                );
            return ["number", Object.is(current, -0) ? "-0" : current];
        }
        if (typeof current !== "object")
            throw new ExecutionError("configuration", "Cache input must contain JSON values only");
        if (seen.has(current)) throw new ExecutionError("configuration", "Cache input is cyclic");
        const prototype = Object.getPrototypeOf(current);
        if (prototype !== Object.prototype && prototype !== null && !Array.isArray(current))
            throw new ExecutionError(
                "configuration",
                "Cache input must not contain class instances",
            );
        seen.add(current);
        try {
            if (Object.getOwnPropertySymbols(current).length)
                throw new ExecutionError(
                    "configuration",
                    "Cache input must not contain symbol properties",
                );
            if (Array.isArray(current)) {
                if (
                    Object.keys(current).length !== current.length ||
                    Object.keys(current).some((key, index) => key !== String(index))
                )
                    throw new ExecutionError(
                        "configuration",
                        "Cache input arrays must be dense without extra properties",
                    );
                return [
                    "array",
                    Array.from({ length: current.length }, (_, index) => {
                        const descriptor = Object.getOwnPropertyDescriptor(current, String(index))!;
                        if (!Object.hasOwn(descriptor, "value"))
                            throw new ExecutionError(
                                "configuration",
                                "Cache input must not contain accessor properties",
                            );
                        return encode(descriptor.value, depth + 1);
                    }),
                ];
            }
            const entries: unknown[] = [];
            for (const key of Object.getOwnPropertyNames(current).sort()) {
                const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
                if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
                    throw new ExecutionError(
                        "configuration",
                        "Cache input must contain enumerable data properties only",
                    );
                entries.push([key, encode(descriptor.value, depth + 1)]);
            }
            return ["object", entries];
        } finally {
            seen.delete(current);
        }
    };
    return JSON.stringify(encode(value, 0));
}

export function createRuntime(options: RuntimeOptions): RuntimeHandle {
    const plan = normalize(options);
    const capacity = options.cacheCapacity ?? 100;
    if (!Number.isSafeInteger(capacity) || capacity < 1)
        configuration("Runtime cache capacity must be a positive finite integer");
    const container = new Container();
    const applicationId = options.app.id;
    const runtimeId = generateUuid();
    const active = new Set<ExecutionHandle>();
    const cache = new LruMap<string, CacheEntry>(capacity);
    const scopeInvalidators = new Set<(tags: readonly string[]) => void>();
    const invalidateListeners = new Set<(tags: readonly string[]) => void>();
    let closed = false;
    let disposal: Promise<void> | undefined;
    let runtimeGeneration = 0;

    for (const provider of plan.providers.values()) container.registerProvider(provider);

    const record = (type: string, fields: Record<string, unknown> = {}) => {
        try {
            const result: unknown = options.recorder?.record(type, {
                ...fields,
                applicationId,
                runtimeId,
            });
            if (result && typeof (result as Promise<unknown>).then === "function")
                void Promise.resolve(result).catch(() => {});
        } catch {
            // Event recording is observational and never changes an operation outcome.
        }
    };

    const invalidate = (inputTags: readonly string[]) => {
        const tags = Object.freeze([...inputTags]);
        if (!tags.length) return;
        runtimeGeneration++;
        for (const [key, entry] of cache)
            if (entry.tags.some((tag) => tags.includes(tag))) cache.delete(key);
        for (const invalidateScope of scopeInvalidators) invalidateScope(tags);
        for (const listener of invalidateListeners) {
            try {
                const result: unknown = listener(tags);
                if (result && typeof (result as Promise<unknown>).then === "function")
                    void Promise.resolve(result).catch(() => {});
            } catch {
                // Web observers cannot prevent cache invalidation.
            }
        }
    };

    const runtime: RuntimeHandle = {
        applicationId,
        runtimeId,
        invalidate,
        onInvalidate(listener) {
            if (closed) configuration("Runtime is closed");
            invalidateListeners.add(listener);
            return () => invalidateListeners.delete(listener);
        },
        record,
        async execute(operation, input, invocation) {
            const execution = runtime.createExecution(invocation);
            let output;
            try {
                output = await execution.execute(operation, input);
            } catch (error) {
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
            const abort = new AbortController();
            const scope = container.createScope(invocation.bindings);
            const executionId = generateUuid();
            const traceId = invocation.traceId ?? executionId;
            const scopeCache = new LruMap<string, CacheEntry>(capacity);
            const inFlight = new Map<string, InFlightEntry>();
            let scopeGeneration = 0;
            const invalidateScope = (tags: readonly string[]) => {
                scopeGeneration++;
                for (const [key, entry] of scopeCache)
                    if (entry.tags.some((tag) => tags.includes(tag))) scopeCache.delete(key);
            };
            scopeInvalidators.add(invalidateScope);
            const forwardAbort = () => abort.abort(invocation.signal?.reason);
            if (invocation.signal?.aborted) forwardAbort();
            else invocation.signal?.addEventListener("abort", forwardAbort, { once: true });
            let disposed = false;
            let disposing: Promise<void> | undefined;
            const running = new Set<Promise<unknown>>();
            const assertActive = () => {
                if (disposed) configuration("Execution is closed");
                if (abort.signal.aborted) throw new ExecutionError("cancelled");
            };
            const executionRecord = (type: string, fields: Record<string, unknown> = {}) =>
                record(type, { ...fields, executionId, traceId });
            const context: ExecutionContext = Object.freeze<ExecutionContext>({
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
                record: executionRecord,
                onDispose: (cleanup) => {
                    assertActive();
                    scope.onDispose(cleanup);
                },
                fetch: async (input, init) => {
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
                executionRecord("operation", { operationId: operation.id, phase: "start" });
                const complete = (cacheHit = false) =>
                    executionRecord("operation", {
                        operationId: operation.id,
                        phase: "complete",
                        ...(cacheHit ? { cacheHit: true } : {}),
                        durationMs: Date.now() - start,
                    });
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
                    const cachePolicy = operation.cache;
                    if (!cachePolicy) {
                        const output = await invoke(operation, validated);
                        complete();
                        return output;
                    }
                    const cacheValue = cachePolicy.key ? cachePolicy.key(validated) : validated;
                    const key = encodeCacheIdentity([
                        operation.id,
                        invocation.identity ?? null,
                        invocation.locale ?? null,
                        cacheValue,
                    ]);
                    const selectedCache = cachePolicy.scope === "execution" ? scopeCache : cache;
                    const cached = selectedCache.get(key);
                    if (cached && cached.expires > Date.now()) {
                        complete(true);
                        return cached.value as O;
                    }
                    if (cached) selectedCache.delete(key);
                    const currentRuntimeGeneration = runtimeGeneration;
                    const currentScopeGeneration = scopeGeneration;
                    const existing = inFlight.get(key);
                    const promise =
                        existing &&
                        existing.runtimeGeneration === currentRuntimeGeneration &&
                        existing.scopeGeneration === currentScopeGeneration
                            ? (existing.promise as Promise<O>)
                            : startCached(
                                  operation,
                                  validated,
                                  key,
                                  cachePolicy,
                                  selectedCache,
                                  currentRuntimeGeneration,
                                  currentScopeGeneration,
                              );
                    const output = await promise;
                    complete();
                    return output;
                } catch (cause) {
                    const error =
                        abort.signal.aborted ||
                        (cause instanceof Error && cause.name === "AbortError")
                            ? new ExecutionError("cancelled", undefined, { cause })
                            : cause instanceof ExecutionError
                              ? cause
                              : cause instanceof HttpError
                                ? executionErrorFromHttp(cause)
                                : new ExecutionError("failure", undefined, { cause });
                    executionRecord("operation", {
                        operationId: operation.id,
                        phase: "error",
                        code: error.code,
                        durationMs: Date.now() - start,
                    });
                    throw error;
                }
            }

            async function invoke<I, O>(operation: Operation<I, O>, input: I): Promise<O> {
                const implementation = plan.implementations.get(operation);
                if (!implementation) configuration(`Unbound operation: ${operation.id}`);
                let output = await implementation.handler(input, context);
                assertActive();
                if (operation.output) {
                    const result = await operation.output["~standard"].validate(output);
                    if (result.issues) throw new ExecutionError("failure");
                    output = result.value;
                }
                assertActive();
                return output;
            }

            function startCached<I, O>(
                operation: Operation<I, O>,
                input: I,
                key: string,
                policy: NonNullable<Operation<I, O>["cache"]>,
                selectedCache: LruMap<string, CacheEntry>,
                expectedRuntimeGeneration: number,
                expectedScopeGeneration: number,
            ): Promise<O> {
                const promise = invoke(operation, input).then((output) => {
                    if (
                        runtimeGeneration === expectedRuntimeGeneration &&
                        scopeGeneration === expectedScopeGeneration
                    )
                        selectedCache.set(key, {
                            value: output,
                            expires: Date.now() + policy.ttlMs,
                            tags: policy.tags ?? [],
                        });
                    return output;
                });
                const entry: InFlightEntry = {
                    promise,
                    runtimeGeneration: expectedRuntimeGeneration,
                    scopeGeneration: expectedScopeGeneration,
                };
                inFlight.set(key, entry);
                afterSettled(promise, () => {
                    if (inFlight.get(key) === entry) inFlight.delete(key);
                });
                return promise;
            }

            const execution: ExecutionHandle = {
                context,
                cancel(reason) {
                    abort.abort(reason);
                },
                execute(operation, input) {
                    const promise = execute(operation, input);
                    running.add(promise);
                    afterSettled(promise, () => running.delete(promise));
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
                            inFlight.clear();
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
                    scopeInvalidators.clear();
                    invalidateListeners.clear();
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
