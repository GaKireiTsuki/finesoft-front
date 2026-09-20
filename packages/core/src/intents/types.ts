/**
 * A route/navigation target.  It remains a data transfer shape only: runtime
 * operation execution never dispatches it or looks up a controller by id.
 */
export interface Intent<T = unknown> {
    readonly id: string;
    readonly params?: Record<string, unknown>;
    readonly _returnType?: T;
}
