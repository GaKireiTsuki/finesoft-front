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
    /** Receives callback and/or task cleanup failures. Defaults to console.error. Awaited during drain. */
    onTaskError?: (error: unknown) => void | Promise<void>;
}
export interface NodeHandlerServer {
    server: ServerType;
    dispose(): Promise<void>;
}
/** Node only listener and managed-task drain; execution remains in the portable handler. */
export async function startNodeHandler(options: NodeHandlerOptions): Promise<NodeHandlerServer> {
    const tasks = new Set<Promise<void>>();
    const requests = new Set<Promise<void>>();
    const trackRequest = (work: Promise<unknown>) => {
        const completed = work
            .then(
                () => {},
                () => {},
            )
            .finally(() => requests.delete(completed));
        requests.add(completed);
    };
    const reportTaskError =
        options.onTaskError ?? ((error: unknown) => console.error("[Node managed task]", error));
    const server = await new Promise<ServerType>((resolve, reject) => {
        const listener = serve(
            {
                fetch: (request) => {
                    const invocation = Promise.resolve().then(() =>
                        options.handler(request, options.bindings, {
                            trackRequest,
                            waitUntil(work) {
                                const observed = work
                                    .then(
                                        () => {},
                                        async (error) => {
                                            try {
                                                await reportTaskError(error);
                                            } catch (reportError) {
                                                console.error(
                                                    "[Node task error reporter]",
                                                    reportError,
                                                    "Task failure:",
                                                    error,
                                                );
                                            }
                                        },
                                    )
                                    .finally(() => tasks.delete(observed));
                                tasks.add(observed);
                            },
                        }),
                    );
                    trackRequest(invocation);
                    return invocation;
                },
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
                // Socket closure can precede a cooperative encoder/cancellation callback settling.
                while (requests.size) await Promise.all(requests);
                while (tasks.size) await Promise.all(tasks);
                await options.runtime?.dispose();
            })()),
    };
}
