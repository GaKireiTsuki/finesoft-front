import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { CompositeLogger, CompositeLoggerFactory } from "../../src/logger/composite";
import { ConsoleLoggerFactory } from "../../src/logger/console";
import { resetFilterCache, shouldLog } from "../../src/logger/local-storage-filter";
import { ReportingLogger, ReportingLoggerFactory } from "../../src/logger/reporting";

beforeEach(() => {
    resetFilterCache();
});

afterEach(() => {
    resetFilterCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("logger utilities", () => {
    test("evaluates localStorage logging rules and tolerates storage errors", () => {
        vi.stubGlobal("localStorage", {
            getItem: vi.fn(() => "*=info,Foo=off,Bar=error"),
        });

        expect(shouldLog("Any", "debug")).toBe(false);
        expect(shouldLog("Any", "info")).toBe(true);
        expect(shouldLog("Foo", "error")).toBe(false);
        expect(shouldLog("Bar", "warn")).toBe(false);
        expect(shouldLog("Bar", "error")).toBe(true);
        expect(shouldLog("Baz", "debug")).toBe(false);

        vi.stubGlobal("localStorage", {
            getItem: vi.fn(() => "Foo=warn"),
        });
        resetFilterCache();

        expect(shouldLog("Bar", "debug")).toBe(true);

        vi.stubGlobal("localStorage", {
            getItem: vi.fn(() => {
                throw new Error("denied");
            }),
        });
        resetFilterCache();

        expect(shouldLog("Any", "debug")).toBe(true);
    });

    test("console loggers respect filters and always log errors", () => {
        vi.stubGlobal("localStorage", {
            getItem: vi.fn(() => "*=info"),
        });
        const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const logger = new ConsoleLoggerFactory().loggerFor("UI");

        logger.debug("debug");
        logger.info("info");
        logger.warn("warn");
        logger.error("error");

        expect(debug).not.toHaveBeenCalled();
        expect(info).toHaveBeenCalledWith("[UI]", "info");
        expect(warn).toHaveBeenCalledWith("[UI]", "warn");
        expect(error).toHaveBeenCalledWith("[UI]", "error");
    });

    test("composite loggers broadcast to all child loggers", () => {
        const first = makeMockLogger();
        const second = makeMockLogger();
        const composite = new CompositeLogger([first, second]);
        const factory = new CompositeLoggerFactory([
            { loggerFor: vi.fn(() => first) },
            { loggerFor: vi.fn(() => second) },
        ]);

        composite.info("hello");
        composite.error("boom");
        factory.loggerFor("api").warn("warn");

        expect(first.info).toHaveBeenCalledWith("hello");
        expect(second.info).toHaveBeenCalledWith("hello");
        expect(first.error).toHaveBeenCalledWith("boom");
        expect(second.error).toHaveBeenCalledWith("boom");
        expect(first.warn).toHaveBeenCalledWith("warn");
        expect(second.warn).toHaveBeenCalledWith("warn");
    });

    test("reporting loggers forward only messages at or above the minimum level", () => {
        const report = vi.fn();
        const logger = new ReportingLogger("api", {
            minLevel: "info",
            report,
        });
        const factory = new ReportingLoggerFactory({ report });

        logger.debug("skip");
        logger.info("info");
        logger.error("error");
        factory.loggerFor("framework").warn("warn");

        expect(report).toHaveBeenNthCalledWith(1, "info", "api", ["info"]);
        expect(report).toHaveBeenNthCalledWith(2, "error", "api", ["error"]);
        expect(report).toHaveBeenNthCalledWith(3, "warn", "framework", ["warn"]);
    });
});

function makeMockLogger() {
    return {
        debug: vi.fn(() => ""),
        info: vi.fn(() => ""),
        warn: vi.fn(() => ""),
        error: vi.fn(() => ""),
    };
}
