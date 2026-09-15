import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { CompositeLogger, CompositeLoggerFactory } from "../../src/logger/composite";
import { ConsoleLoggerFactory } from "../../src/logger/console";
import { ReportingLogger, ReportingLoggerFactory } from "../../src/logger/reporting";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("logger utilities", () => {
    test("console loggers respect filters and always log errors", () => {
        const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const logger = new ConsoleLoggerFactory((_category, level) => level !== "debug").loggerFor(
            "UI",
        );

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

    test("reporting logger swallows callback errors instead of crashing callers", () => {
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const report = vi.fn(() => {
            throw new Error("sentry down");
        });
        const logger = new ReportingLogger("api", { report });

        expect(() => logger.warn("boom")).not.toThrow();
        expect(report).toHaveBeenCalledTimes(1);
        expect(errSpy).toHaveBeenCalledWith(
            "[ReportingLogger] report callback threw:",
            expect.any(Error),
        );
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
