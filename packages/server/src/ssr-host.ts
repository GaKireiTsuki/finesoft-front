import { createSSRHandler, type SSRHandlerOptions, type SSRModule } from "./ssr-handler";
/** Explicitly takes ownership of the renderers loaded by a standard application host. */
export function createSSRHost<T>(options: SSRHandlerOptions<T>) {
    const owners = new Set<SSRModule<T>["render"]>();
    if ("render" in options) owners.add(options.render);
    const active = new Set<Promise<Response>>();
    let closing: Promise<void> | undefined;
    const handler = createSSRHandler({
        ...options,
        async loadModule(request: Request) {
            const module = "loadModule" in options ? await options.loadModule(request) : options;
            owners.add(module.render);
            return module;
        },
    });
    return {
        handle(request: Request, bindings?: Readonly<Record<string, unknown>>) {
            if (closing)
                return Promise.resolve(new Response("Application closed", { status: 503 }));
            const work = handler(request, bindings);
            active.add(work);
            void work.finally(() => active.delete(work)).catch(() => {});
            return work;
        },
        dispose(): Promise<void> {
            return (closing ??= (async () => {
                while (active.size) await Promise.allSettled(active);
                const results = await Promise.allSettled(
                    [...owners].map(async (render) => {
                        await render.dispose?.();
                    }),
                );
                owners.clear();
                const errors = results
                    .filter((result) => result.status === "rejected")
                    .map((result) => result.reason);
                if (errors.length) throw new AggregateError(errors, "SSR cleanup failed");
            })());
        },
    };
}
