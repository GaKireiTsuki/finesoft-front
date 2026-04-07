import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { ActionDispatcher } from "../../src/actions/dispatcher";
import {
    ACTION_KINDS,
    makeExternalUrlAction,
    makeFlowAction,
    type Action,
    type CompoundAction,
    type ExternalUrlAction,
    type FlowAction,
} from "../../src/actions/types";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("ActionDispatcher", () => {
    test("dispatches a registered action handler", async () => {
        const dispatcher = new ActionDispatcher();
        const handler = vi.fn();
        const action = makeFlowAction("/home");

        dispatcher.onAction(ACTION_KINDS.FLOW, handler);
        await dispatcher.perform(action);

        expect(handler).toHaveBeenCalledWith(action);
    });

    test("keeps the first handler when the same kind is registered twice", async () => {
        const dispatcher = new ActionDispatcher();
        const first = vi.fn();
        const second = vi.fn();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        dispatcher.onAction(ACTION_KINDS.FLOW, first);
        dispatcher.onAction(ACTION_KINDS.FLOW, second);
        await dispatcher.perform(makeFlowAction("/first"));

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(
            '[ActionDispatcher] kind="flow" already registered, skipping',
        );
    });

    test("warns when no handler is registered for an action kind", async () => {
        const dispatcher = new ActionDispatcher();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        await dispatcher.perform(makeExternalUrlAction("https://example.com"));

        expect(warn).toHaveBeenCalledWith('[ActionDispatcher] No handler for kind="externalUrl"');
    });

    test("recursively expands compound actions in order", async () => {
        const dispatcher = new ActionDispatcher();
        const handled: string[] = [];

        dispatcher.onAction(ACTION_KINDS.FLOW, (action: FlowAction) => {
            handled.push(`flow:${action.url}`);
        });
        dispatcher.onAction(ACTION_KINDS.EXTERNAL_URL, (action: ExternalUrlAction) => {
            handled.push(`external:${action.url}`);
        });

        const action: CompoundAction = {
            kind: ACTION_KINDS.COMPOUND,
            actions: [
                makeFlowAction("/alpha"),
                {
                    kind: ACTION_KINDS.COMPOUND,
                    actions: [
                        makeExternalUrlAction("https://example.com"),
                        makeFlowAction("/beta"),
                    ],
                },
            ],
        };

        await dispatcher.perform(action);

        expect(handled).toEqual(["flow:/alpha", "external:https://example.com", "flow:/beta"]);
    });

    test("throws when compound actions exceed the recursion limit", async () => {
        const dispatcher = new ActionDispatcher();
        const action = makeNestedCompoundAction(33);

        await expect(dispatcher.perform(action)).rejects.toThrow(
            /CompoundAction recursion depth exceeded/,
        );
    });
});

function makeNestedCompoundAction(depth: number): Action {
    let current: Action = makeFlowAction("/leaf");

    for (let i = 0; i < depth; i++) {
        current = {
            kind: ACTION_KINDS.COMPOUND,
            actions: [current],
        };
    }

    return current;
}
