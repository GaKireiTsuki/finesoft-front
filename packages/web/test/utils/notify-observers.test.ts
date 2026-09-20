import { expect, test, vi } from "vite-plus/test";
import { notifyObservers } from "../../src/utils/notify-observers";

test("isolates sync, async and thenable failures without awaiting observers or skipping the next listener", async () => {
    const onError = vi.fn();
    const observed: number[] = [];
    let release!: () => void;
    const listeners = new Set<(value: number) => unknown>([
        () => {
            throw new Error("sync");
        },
        () => Promise.reject(new Error("async")),
        () => ({
            // oxlint-disable-next-line unicorn/no-thenable -- Exercise a throwing thenable getter.
            get then() {
                throw new Error("thenable");
            },
        }),
        () =>
            new Promise<void>((resolve) => {
                release = resolve;
            }),
        (value) => observed.push(value),
    ]);
    notifyObservers(listeners, onError, 7);
    expect(observed).toEqual([7]);
    expect(onError).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(3);
    release();
});
