import type { Token } from "./token";
export interface ProviderContext {
    readonly bindings: Readonly<Record<string, unknown>>;
    get<T>(token: Token<T>): Promise<T>;
}
export interface Provider<T = unknown> {
    readonly token: Token<T>;
    readonly lifetime: "runtime" | "scope" | "transient";
    readonly dependencies?: readonly Token[];
    readonly capabilities?: readonly string[];
    readonly create?: (context: ProviderContext) => T | Promise<T>;
    readonly value?: T;
    /** Created resources are owned. Supplied values are external unless owned is true. */
    readonly owned?: boolean;
    readonly dispose?: (value: T) => void | Promise<void>;
}
export function provide<T>(provider: Provider<T>): Provider<T> {
    return Object.freeze({
        ...provider,
        dependencies: Object.freeze([...(provider.dependencies ?? [])]),
        capabilities: Object.freeze([...(provider.capabilities ?? [])]),
    });
}
