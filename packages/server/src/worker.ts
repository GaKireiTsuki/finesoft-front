import { createHttpHandler, type HttpHandlerOptions, type HttpHost } from "./http";
export { runManagedTask, type ManagedTask } from "./http";
/** Worker fetch host. No DOM, Hono, Node or implicit detached work. */
export function createWorkerHandler(options: HttpHandlerOptions) {
    const handler = createHttpHandler(options);
    return {
        fetch(
            request: Request,
            bindings: Readonly<Record<string, unknown>> = {},
            context?: HttpHost,
        ): Promise<Response> {
            // Calls in the handler use host.method(), retaining the original host receiver.
            return handler(request, bindings, context);
        },
    };
}
