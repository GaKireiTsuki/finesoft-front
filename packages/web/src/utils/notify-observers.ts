/** Notify without awaiting observers or allowing their failures to break a committed state. */
export function notifyObservers<A extends unknown[]>(
    listeners: Iterable<(...args: A) => unknown>,
    onError: () => void,
    ...args: A
): void {
    for (const listener of listeners) {
        try {
            const result = listener(...args);
            if (result && typeof (result as Promise<unknown>).then === "function")
                void Promise.resolve(result).catch(onError);
        } catch {
            onError();
        }
    }
}
