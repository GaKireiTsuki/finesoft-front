import type { FlowAction, Framework, Logger, RouteMatch } from "@finesoft/core";
import { ACTION_KINDS, next } from "@finesoft/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../../core/src/index.ts"));

const historyMocks = vi.hoisted(() => ({
    beforeTransition: vi.fn(),
    replaceState: vi.fn(),
    pushState: vi.fn(),
    replaceUrl: vi.fn(),
    pushUrl: vi.fn(),
    onPopState: vi.fn(),
}));

vi.mock("../utils/history", () => ({
    History: class {
        beforeTransition = historyMocks.beforeTransition;
        replaceState = historyMocks.replaceState;
        pushState = historyMocks.pushState;
        replaceUrl = historyMocks.replaceUrl;
        pushUrl = historyMocks.pushUrl;
        onPopState = historyMocks.onPopState;
    },
}));

import { KeepAliveController } from "../keep-alive";
import { registerFlowActionHandler } from "./flow-action";

describe("registerFlowActionHandler", () => {
    beforeEach(() => {
        historyMocks.beforeTransition.mockReset();
        historyMocks.replaceState.mockReset();
        historyMocks.pushState.mockReset();
        historyMocks.replaceUrl.mockReset();
        historyMocks.pushUrl.mockReset();
        historyMocks.onPopState.mockReset();

        vi.stubGlobal("window", {
            location: {
                pathname: "/",
                search: "",
                origin: "https://example.com",
                href: "https://example.com/",
            },
            history: {
                state: null,
                pushState: vi.fn(),
                replaceState: vi.fn(),
            },
            addEventListener: vi.fn(),
        });
        vi.stubGlobal("document", {
            getElementById: vi.fn(() => null),
            documentElement: {},
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test("reuses keepAlive pages without dispatching the controller again", async () => {
        const page = {
            id: "about",
            pageType: "about",
            title: "About",
            url: "/about",
        };
        const handlers = new Map<string, (action: FlowAction) => Promise<void>>();
        const routeMatch: RouteMatch = {
            intent: { id: "about", params: {} },
            action: { kind: ACTION_KINDS.FLOW, url: "/about" },
        };
        const dispatchMock = vi.fn(async () => page);
        const didEnterPageMock = vi.fn();
        const framework = {
            routeUrl: vi.fn(() => routeMatch),
            runBeforeLoad: vi.fn(async () => next()),
            runAfterLoad: vi.fn(async () => next()),
            dispatch: dispatchMock,
            didEnterPage: didEnterPageMock,
            onAction: vi.fn((kind: string, handler: (action: FlowAction) => Promise<void>) => {
                handlers.set(kind, handler);
            }),
            container: {},
        } as unknown as Framework;
        const log = makeLogger();
        const callbacks = {
            onNavigate: vi.fn(),
            onModal: vi.fn(),
        };
        const updateApp = vi.fn();
        const keepAlive = new KeepAliveController();
        keepAlive.markCacheable("/about", page);

        registerFlowActionHandler({
            framework,
            log,
            callbacks,
            updateApp,
            keepAlive,
        });

        const flowHandler = handlers.get(ACTION_KINDS.FLOW);
        expect(flowHandler).toBeDefined();

        await flowHandler?.({
            kind: ACTION_KINDS.FLOW,
            url: "/about",
        });

        expect(dispatchMock).not.toHaveBeenCalled();
        expect(updateApp).toHaveBeenCalledWith(
            expect.objectContaining({
                page,
                cacheKey: "/about",
                cacheHit: true,
                navigationType: "navigate",
            }),
        );
        expect(didEnterPageMock).toHaveBeenCalledWith(page);
        expect(historyMocks.replaceState).toHaveBeenCalledWith({ page }, "/about");
    });
});

function makeLogger(): Logger & {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
} {
    return {
        debug: vi.fn(() => ""),
        info: vi.fn(() => ""),
        warn: vi.fn(() => ""),
        error: vi.fn(() => ""),
    };
}
