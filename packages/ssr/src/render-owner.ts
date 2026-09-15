/** A retained Runtime cannot end while its materialized render calls are still using it. */
export function ownRender<Args extends unknown[], Result>(
    render: (...args: Args) => Promise<Result>,
    cleanup: () => Promise<void>,
) {
    const active = new Set<Promise<Result>>();
    let closing: Promise<void> | undefined;
    return Object.assign(
        (...args: Args) => {
            if (closing) return Promise.reject(Error("SSR renderer disposed"));
            const work = render(...args);
            active.add(work);
            void work.finally(() => active.delete(work)).catch(() => {});
            return work;
        },
        {
            dispose: () =>
                (closing ??= (async () => {
                    while (active.size) await Promise.allSettled(active);
                    await cleanup();
                })()),
        },
    );
}
