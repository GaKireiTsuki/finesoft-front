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
}
export interface ExecutionHandle {
    readonly context: ExecutionContext;
    execute<I, O>(operation: Operation<I, O>, input: I): Promise<O>;
    dispose(): Promise<void>;
}
export interface RuntimeHandle {
    readonly applicationId: string;
    readonly runtimeId: string;
    execute<I, O>(operation: Operation<I, O>, input: I, invocation?: Invocation): Promise<O>;
    createExecution(invocation?: Invocation): ExecutionHandle;
    invalidate(tags: readonly string[]): void;
    dispose(): Promise<void>;
}
export type ExecutionErrorCode =
    | "validation"
    | "denied"
    | "not_found"
    | "cancelled"
    | "failure"
    | "capability"
    | "configuration";
const errors = {
    validation: [400, "Invalid input"],
    denied: [403, "Access denied"],
    not_found: [404, "Not found"],
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
