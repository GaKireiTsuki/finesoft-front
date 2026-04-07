import { describe, expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import * as browserEntry from "../src/index";

describe("browser package entry", () => {
    test("re-exports browser runtime utilities and core helpers", () => {
        expect(browserEntry.History).toBeDefined();
        expect(browserEntry.startBrowserApp).toBeDefined();
        expect(browserEntry.tryScroll).toBeDefined();
        expect(browserEntry.createPrefetchedIntentsFromDom).toBeDefined();
        expect(browserEntry.Framework).toBeDefined();
        expect(browserEntry.makeFlowAction("/products")).toEqual({
            kind: "flow",
            url: "/products",
            presentationContext: undefined,
        });
    });
});
