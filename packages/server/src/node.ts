import { serve, type ServerType } from "@hono/node-server";
import type { RuntimeHandle } from "@finesoft/core";
import type { HttpHandler } from "./http";
export { nodeDnsLookup } from "./node/dns";
export interface NodeHandlerOptions {
    handler: HttpHandler;
    port?: number;
    hostname?: string;
    bindings?: Readonly<Record<string, unknown>>;
    /** Passing a runtime explicitly transfers its shutdown responsibility to this host. */
    runtime?: RuntimeHandle;
}
export interface NodeHandlerServer {
    server: ServerType;
    dispose(): Promise<void>;
}
/** Node only listener and managed-task drain; execution remains in the portable handler. */
export async function startNodeHandler(options: NodeHandlerOptions): Promise<NodeHandlerServer> {
    const tasks = new Set<Promise<unknown>>();
    const server = await new Promise<ServerType>((resolve, reject) => {
        const listener = serve(
            {
                fetch: (request) =>
                    options.handler(request, options.bindings, {
                        waitUntil(work) {
                            const observed = work
                                .catch(() => {})
                                .finally(() => tasks.delete(observed));
                            tasks.add(observed);
                        },
                    }),
                port: options.port ?? 3000,
                hostname: options.hostname,
            },
            () => resolve(listener),
        );
        listener.once("error", reject);
    });
    let closing: Promise<void> | undefined;
    return {
        server,
        dispose: () =>
            (closing ??= (async () => {
                await new Promise<void>((resolve, reject) =>
                    server.close((error) => (error ? reject(error) : resolve())),
                );
                await Promise.all(tasks);
                await options.runtime?.dispose();
            })()),
    };
}
