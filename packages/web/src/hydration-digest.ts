/** @internal A versioned DOM change detector, not a security or authenticity check. */
export function createHydrationDigest() {
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    const update = (value: number) => {
        first = Math.imul(first ^ value, 0x01000193);
        second = Math.imul(second ^ value, 0x85ebca6b);
    };
    return {
        write(value: string) {
            update(value.length);
            for (let index = 0; index < value.length; index++) update(value.charCodeAt(index));
        },
        value: () => `v1:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`,
    };
}
