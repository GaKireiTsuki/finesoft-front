import { createHttpHandler } from "@finesoft/front/http";
import { startNodeHandler } from "@finesoft/front/node";
import { createFixture } from "./business";
import { fixtureConfig } from "../config";
export async function startFixture() {
    const { runtime, options } = createFixture();
    return startNodeHandler({
        handler: createHttpHandler(options),
        runtime,
        port: 0,
        hostname: "127.0.0.1",
        bindings: fixtureConfig.bindings,
    });
}
