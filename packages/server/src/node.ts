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
    disposeApp?: () => Promise<void>;
    /** Explicit full-error observer, awaited during drain. Default/fallback diagnostics contain only a safe failure code. */
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
        options.onTaskError ?? (() => console.error("[Node managed task]", { code: "failure" }));
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
                                            } catch {
                                                console.error("[Node managed task]", {
                                                    code: "failure",
                                                    reporterFailed: true,
                                                });
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
                try {
                    await options.disposeApp?.();
                } finally {
                    await options.runtime?.dispose();
                }
            })()),
    };
}
