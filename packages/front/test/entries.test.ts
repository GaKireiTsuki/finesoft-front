import { describe, expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", () => ({
    Framework: "FrameworkExport",
    makeFlowAction: (url: string) => ({
        kind: "flow",
        url,
        presentationContext: undefined,
    }),
}));

vi.mock("@finesoft/browser", () => ({
    History: "HistoryExport",
    createPrefetchedIntentsFromDom: "createPrefetchedIntentsFromDom",
    deserializeServerData: "deserializeServerData",
    registerActionHandlers: "registerActionHandlers",
    registerExternalUrlHandler: "registerExternalUrlHandler",
    registerFlowActionHandler: "registerFlowActionHandler",
    startBrowserApp: "startBrowserApp",
    tryScroll: "tryScroll",
}));

vi.mock("@finesoft/ssr", () => ({
    SSR_PLACEHOLDERS: "SSR_PLACEHOLDERS",
    createSSRRender: "createSSRRender",
    injectCSRShell: "injectCSRShell",
    injectSSRContent: "injectSSRContent",
    serializeServerData: "serializeServerData",
    ssrRender: "ssrRender",
}));

vi.mock("@finesoft/server", () => ({
    createServer: "createServer",
}));

import * as browserEntry from "../src/browser";
import * as fullEntry from "../src/index";

describe("front package entries", () => {
    test("re-exports full-stack modules from the main entry", () => {
        expect(fullEntry.Framework).toBe("FrameworkExport");
        expect(fullEntry.History).toBe("HistoryExport");
        expect(fullEntry.SSR_PLACEHOLDERS).toBe("SSR_PLACEHOLDERS");
        expect(fullEntry.createServer).toBe("createServer");
    });

    test("re-exports browser-only modules without server exports", () => {
        expect(browserEntry.Framework).toBe("FrameworkExport");
        expect(browserEntry.History).toBe("HistoryExport");
        expect(browserEntry.startBrowserApp).toBe("startBrowserApp");
        expect("createServer" in browserEntry).toBe(false);
    });
});
