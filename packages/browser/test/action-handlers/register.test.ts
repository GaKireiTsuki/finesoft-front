import { describe, expect, test, vi } from "vite-plus/test";

const { registerExternalUrlHandler, registerFlowActionHandler } = vi.hoisted(() => ({
    registerFlowActionHandler: vi.fn(),
    registerExternalUrlHandler: vi.fn(),
}));

vi.mock("../../src/action-handlers/flow-action", () => ({
    registerFlowActionHandler,
}));

vi.mock("../../src/action-handlers/external-url-action", () => ({
    registerExternalUrlHandler,
}));

import { registerActionHandlers } from "../../src/action-handlers/register";

describe("registerActionHandlers", () => {
    test("registers flow and external URL handlers", () => {
        const deps = {
            framework: { onAction: vi.fn() },
            log: { debug: vi.fn() },
            callbacks: {
                onNavigate: vi.fn(),
                onModal: vi.fn(),
            },
            updateApp: vi.fn(),
            getScrollablePageElement: vi.fn(() => null),
        };

        registerActionHandlers(deps as never);

        expect(registerFlowActionHandler).toHaveBeenCalledWith({
            framework: deps.framework,
            log: deps.log,
            callbacks: deps.callbacks,
            updateApp: deps.updateApp,
            getScrollablePageElement: deps.getScrollablePageElement,
        });
        expect(registerExternalUrlHandler).toHaveBeenCalledWith({
            framework: deps.framework,
            log: deps.log,
        });
    });
});
