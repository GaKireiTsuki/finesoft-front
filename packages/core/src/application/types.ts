import type { Container } from "../dependencies/container";
import type { Token } from "../dependencies/token";
import type { Provider } from "../dependencies/providers";
import type { StandardSchemaV1 } from "../schema/standard";
import type { EventRecorder } from "../metrics/types";

export interface Invocation {
    readonly fetch?: typeof globalThis.fetch;
    readonly signal?: AbortSignal;
    readonly traceId?: string;
    readonly bindings?: Readonly<Record<string, unknown>>;
    readonly locale?: string;
    readonly identity?: string;
}
export interface ExecutionContext {
    readonly applicationId: string;
    readonly runtimeId: string;
    readonly executionId: string;
    readonly traceId: string;
    readonly signal: AbortSignal;
    readonly container: Container;
    readonly bindings: Readonly<Record<string, unknown>>;
    readonly locale?: string;
    readonly identity?: string;
    readonly fetch: typeof globalThis.fetch;
    get<T>(token: Token<T>): Promise<T>;
    execute<I, O>(operation: Operation<I, O>, input: I): Promise<O>;
    invalidate(tags: readonly string[]): void;
    record(type: string, fields?: Record<string, unknown>): void;
    onDispose(cleanup: () => void | Promise<void>): void;
}
export type OperationHandler<I, O> = (input: I, context: ExecutionContext) => O | Promise<O>;
export type OperationPolicy<I = unknown> = (
    input: I,
    context: ExecutionContext,
) => void | Promise<void>;
export interface QueryCache<I> {
    readonly scope?: "runtime" | "execution";
    readonly ttlMs: number;
    readonly key?: (input: I) => string;
    readonly tags?: readonly string[];
}
export interface Operation<I = unknown, O = unknown> {
    readonly id: string;
    readonly kind: "query" | "command";
    readonly input?: StandardSchemaV1<unknown, I>;
    readonly output?: StandardSchemaV1<unknown, O>;
    readonly handler?: OperationHandler<I, O>;
    readonly policies?: readonly OperationPolicy<I>[];
    readonly cache?: QueryCache<I>;
    readonly capabilities?: readonly string[];
}
// Erasure is confined to heterogeneous declaration collections; execution keeps I/O linked.
export type AnyOperation = Operation<any, any>;
export interface Implementation<I = any, O = any> {
    readonly operation: Operation<I, O>;
    readonly handler: OperationHandler<I, O>;
}
export interface ModuleDefinition {
    readonly id: string;
    readonly dependsOn?: readonly ModuleDefinition[];
    readonly operations?: readonly AnyOperation[];
    readonly implementations?: readonly Implementation[];
    readonly providers?: readonly Provider<any>[];
    readonly policies?: readonly OperationPolicy<any>[];
}
export interface AppDefinition extends Omit<ModuleDefinition, "dependsOn"> {
    readonly modules?: readonly ModuleDefinition[];
}
export interface RuntimeOptions {
    /** Capabilities the host promises to supply per invocation, checked before operation policies. */
    readonly invocationCapabilities?: readonly "fetch"[];
    readonly app: AppDefinition;
    readonly implementations?: readonly Implementation[];
    readonly providers?: readonly Provider<any>[];
    readonly capabilities?: Readonly<Record<string, unknown>> & {
        readonly fetch?: typeof globalThis.fetch;
    };
    readonly recorder?: EventRecorder;
    /** Maximum number of completed query results retained per cache scope. */
    readonly cacheCapacity?: number;
}
export interface ExecutionHandle {
    readonly context: ExecutionContext;
    /** Abort this execution without disposing its scope; the owner still calls dispose(). */
    cancel(reason?: unknown): void;
    execute<I, O>(operation: Operation<I, O>, input: I): Promise<O>;
    dispose(): Promise<void>;
}
export interface RuntimeHandle {
    readonly applicationId: string;
    readonly runtimeId: string;
    execute<I, O>(operation: Operation<I, O>, input: I, invocation?: Invocation): Promise<O>;
    createExecution(invocation?: Invocation): ExecutionHandle;
    invalidate(tags: readonly string[]): void;
    onInvalidate(listener: (tags: readonly string[]) => void): () => void;
    /** Record a host/application event without making recorder failures observable. */
    record(type: string, fields?: Record<string, unknown>): void;
    dispose(): Promise<void>;
}
export type ExecutionErrorCode =
    | "validation"
    | "unauthenticated"
    | "denied"
    | "not_found"
    | "conflict"
    | "rate_limited"
    | "cancelled"
    | "failure"
    | "capability"
    | "configuration";
const errors = {
    validation: [400, "Invalid input"],
    unauthenticated: [401, "Authentication required"],
    denied: [403, "Access denied"],
    not_found: [404, "Not found"],
    conflict: [409, "Request conflicts with current state"],
    rate_limited: [429, "Too many requests"],
    cancelled: [499, "Execution cancelled"],
    failure: [500, "Execution failed"],
    capability: [503, "Required capability unavailable"],
    configuration: [500, "Invalid application configuration"],
} as const;
export class ExecutionError extends Error {
    readonly status: number;
    constructor(
        readonly code: ExecutionErrorCode,
        message?: string,
        options?: ErrorOptions,
    ) {
        super(message ?? errors[code][1], options);
        this.name = "ExecutionError";
        this.status = errors[code][0];
    }
}

/** Convert a known upstream HTTP failure to the safe public execution vocabulary. */
export function executionErrorFromHttp(error: { readonly status: number }): ExecutionError {
    const code =
        error.status === 400
            ? "validation"
            : error.status === 401
              ? "unauthenticated"
              : error.status === 403
                ? "denied"
                : error.status === 404
                  ? "not_found"
                  : error.status === 409
                    ? "conflict"
                    : error.status === 429
                      ? "rate_limited"
                      : "failure";
    return new ExecutionError(code, undefined, { cause: error });
}
