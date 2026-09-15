import { describe, expect, test } from "vite-plus/test";
import { NAVIGATION_NODE_KINDS, NavigationError } from "../../src/navigation/types";

describe("navigation/types runtime members", () => {
    test("NAVIGATION_NODE_KINDS exposes the four node kinds", () => {
        expect(NAVIGATION_NODE_KINDS).toEqual({
            LEAF: "leaf",
            STACK: "stack",
            TABS: "tabs",
            SPLIT: "split",
        });
    });

    test("NavigationError is an Error with the right name", () => {
        const err = new NavigationError("boom");
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(NavigationError);
        expect(err.name).toBe("NavigationError");
        expect(err.message).toBe("boom");
    });
});
