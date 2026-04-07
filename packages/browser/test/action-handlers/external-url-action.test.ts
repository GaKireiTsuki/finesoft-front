import type { Logger } from "@finesoft/core";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../../core/src/index.ts"));

import { ACTION_KINDS } from "../../../core/src/index.ts";
import { registerExternalUrlHandler } from "../../src/action-handlers/external-url-action";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("registerExternalUrlHandler", () => {
    test("registers an external URL action handler", () => {
        const framework = {
            onAction: vi.fn(),
        };
        const log = makeLogger();
        const open = vi.fn();
        vi.stubGlobal("window", { open });

        registerExternalUrlHandler({ framework: framework as never, log });

        expect(framework.onAction).toHaveBeenCalledTimes(1);
        const [kind, handler] = framework.onAction.mock.calls[0];
        expect(kind).toBe(ACTION_KINDS.EXTERNAL_URL);

        handler({
            kind: ACTION_KINDS.EXTERNAL_URL,
            url: "https://example.com",
        });

        expect(log.debug).toHaveBeenCalledWith("ExternalUrlAction → https://example.com");
        expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
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
