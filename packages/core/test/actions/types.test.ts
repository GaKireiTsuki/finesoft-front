import { describe, expect, test } from "vite-plus/test";
import {
    ACTION_KINDS,
    isCompoundAction,
    isExternalUrlAction,
    isFlowAction,
    makeExternalUrlAction,
    makeFlowAction,
    type Action,
} from "../../src/actions/types";

describe("action type helpers", () => {
    test("identifies action kinds with dedicated type guards", () => {
        const flow = makeFlowAction("/products", "modal");
        const external = makeExternalUrlAction("https://example.com");
        const compound: Action = {
            kind: ACTION_KINDS.COMPOUND,
            actions: [flow, external],
        };

        expect(isFlowAction(flow)).toBe(true);
        expect(isFlowAction(external)).toBe(false);
        expect(isExternalUrlAction(external)).toBe(true);
        expect(isExternalUrlAction(compound)).toBe(false);
        expect(isCompoundAction(compound)).toBe(true);
        expect(isCompoundAction(flow)).toBe(false);
    });

    test("creates flow and external URL actions with the expected payloads", () => {
        expect(makeFlowAction("/home")).toEqual({
            kind: ACTION_KINDS.FLOW,
            url: "/home",
            presentationContext: undefined,
        });
        expect(makeFlowAction("/cart", "modal")).toEqual({
            kind: ACTION_KINDS.FLOW,
            url: "/cart",
            presentationContext: "modal",
        });
        expect(makeExternalUrlAction("https://example.com/docs")).toEqual({
            kind: ACTION_KINDS.EXTERNAL_URL,
            url: "https://example.com/docs",
        });
    });
});
