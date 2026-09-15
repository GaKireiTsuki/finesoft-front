import { createWorkerHandler } from "@finesoft/front/worker";
import { createFixture } from "./business";
import type { FixtureBindings } from "../config";
import type { HttpHost } from "@finesoft/front/http";
let handler: ReturnType<typeof createWorkerHandler> | undefined;
export default {
    fetch(request: Request, bindings: FixtureBindings, context: HttpHost) {
        // workerd forbids random IDs/I/O during module evaluation. Runtime initialization is lazy.
        handler ??= createWorkerHandler(createFixture().options);
        return handler.fetch(request, bindings, context);
    },
};
