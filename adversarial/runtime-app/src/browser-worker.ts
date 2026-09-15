import { createFixture, inspect } from "./business";
import { ExecutionError } from "@finesoft/front";
interface InspectMessage {
    protocolVersion: 1;
    id: string;
    operation: "inspect";
    input: number;
    tenant: string;
    authorized: boolean;
}
function decode(value: unknown): InspectMessage {
    if (!value || typeof value !== "object") throw Error("invalid-message");
    const message = value as Partial<InspectMessage>;
    if (
        message.protocolVersion !== 1 ||
        typeof message.id !== "string" ||
        message.operation !== "inspect" ||
        typeof message.input !== "number" ||
        !Number.isFinite(message.input) ||
        typeof message.tenant !== "string" ||
        typeof message.authorized !== "boolean"
    )
        throw Error("invalid-message");
    return message as InspectMessage;
}
const { runtime } = createFixture();
let work = Promise.resolve();
self.onmessage = (event: MessageEvent<unknown>) => {
    work = work.then(async () => {
        if (
            event.data &&
            typeof event.data === "object" &&
            "operation" in event.data &&
            event.data.operation === "dispose" &&
            "protocolVersion" in event.data &&
            event.data.protocolVersion === 1
        ) {
            await runtime.dispose();
            self.postMessage({ protocolVersion: 1, operation: "disposed" });
            self.close();
            return;
        }
        let message: InspectMessage;
        try {
            message = decode(event.data);
        } catch {
            self.postMessage({ protocolVersion: 1, error: "invalid-message" });
            return;
        }
        try {
            const result = await runtime.execute(inspect, message.input, {
                identity: message.authorized ? "fixture-authorized" : undefined,
                bindings: { TENANT: message.tenant },
            });
            self.postMessage({
                protocolVersion: 1,
                id: message.id,
                result: { value: result.value, tenant: result.tenant },
                dom: typeof document,
            });
        } catch (error) {
            self.postMessage({
                protocolVersion: 1,
                id: message.id,
                error: error instanceof ExecutionError ? error.code : "failure",
            });
        }
    });
};
