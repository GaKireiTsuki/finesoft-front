import type { HttpHandler } from "../src/http";
import type { NodeHandlerOptions } from "../src/node";

declare const handler: HttpHandler;
const options: NodeHandlerOptions = { handler };
const invalid: NodeHandlerOptions = {
    // @ts-expect-error Node hosts receive the handler owner, not a detached fetch function.
    handler: handler.fetch.bind(handler),
};
void [options, invalid];
