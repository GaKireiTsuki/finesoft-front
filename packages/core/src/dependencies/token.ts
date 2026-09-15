/** A service reference carries its value type without a string-based assertion. */
export interface Token<T = unknown> {
    readonly id: string;
    readonly _value?: T;
}
export function createToken<T>(id: string): Token<T> {
    if (!id) throw new Error("Token ID must not be empty");
    return Object.freeze({ id });
}
