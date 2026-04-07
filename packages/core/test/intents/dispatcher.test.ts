import { describe, expect, test, vi } from "vite-plus/test";
import { Container } from "../../src/dependencies/container";
import { IntentDispatcher } from "../../src/intents/dispatcher";

describe("IntentDispatcher", () => {
    test("registers and dispatches intents to matching controllers", async () => {
        const dispatcher = new IntentDispatcher();
        const container = new Container();
        const controller = {
            intentId: "home",
            perform: vi.fn(() => ({ title: "Home" })),
        };
        const intent = { id: "home", params: { page: "1" } };

        dispatcher.register(controller);

        await expect(dispatcher.dispatch(intent, container)).resolves.toEqual({
            title: "Home",
        });
        expect(controller.perform).toHaveBeenCalledWith(intent, container);
        expect(dispatcher.has("home")).toBe(true);
    });

    test("throws a helpful error when no controller is registered", async () => {
        const dispatcher = new IntentDispatcher();
        const container = new Container();

        dispatcher.register({
            intentId: "known",
            perform: vi.fn(),
        });

        await expect(dispatcher.dispatch({ id: "missing" }, container)).rejects.toThrow(
            '[IntentDispatcher] No controller for "missing". Registered: [known]',
        );
        expect(dispatcher.has("missing")).toBe(false);
    });
});
