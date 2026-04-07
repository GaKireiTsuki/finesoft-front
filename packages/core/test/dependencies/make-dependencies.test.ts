import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { Container } from "../../src/dependencies/container";
import {
    DEP_KEYS,
    makeDependencies,
    type FeatureFlags,
    type Logger,
    type LoggerFactory,
    type MetricsRecorder,
    type Net,
    type Storage,
} from "../../src/dependencies/make-dependencies";
import type { Translator } from "../../src/i18n/types";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("makeDependencies", () => {
    test("registers and wires framework dependencies from configuration", async () => {
        const container = new Container();
        const fetchFn = vi.fn(async () => new Response("{}"));
        const report = vi.fn();
        const eventRecorder = {
            record: vi.fn(),
            flush: vi.fn(async () => {}),
            destroy: vi.fn(),
        };
        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const platform = {
            os: "macos",
            browser: "chrome",
            engine: "blink",
            isMobile: false,
            isTouch: false,
        } as const;

        makeDependencies(container, {
            fetch: fetchFn,
            featureFlags: {
                localFlag: true,
                greeting: "hello",
                retries: 3,
            },
            featureFlagsProviders: [
                {
                    isEnabled: (key: string) => key === "remoteFlag",
                    getString: (key: string) => (key === "theme" ? "dark" : undefined),
                    getNumber: (key: string) => (key === "pageSize" ? 20 : undefined),
                },
            ],
            reportCallback: report,
            eventRecorder,
            locale: "en-US",
            platform,
            _resolvedMessages: { hello: "Hello" },
        } as never);

        const net = container.resolve<Net>(DEP_KEYS.NET);
        await net.fetch("/api/items", { method: "POST" });
        expect(fetchFn).toHaveBeenCalledWith("/api/items", { method: "POST" });

        const rawFetch = container.resolve<typeof globalThis.fetch>(DEP_KEYS.FETCH);
        await rawFetch("/raw");
        expect(fetchFn).toHaveBeenNthCalledWith(2, "/raw");

        const storage = container.resolve<Storage>(DEP_KEYS.STORAGE);
        storage.set("token", "abc");
        expect(storage.get("token")).toBe("abc");
        storage.delete("token");
        expect(storage.get("token")).toBeUndefined();

        const flags = container.resolve<FeatureFlags>(DEP_KEYS.FEATURE_FLAGS);
        expect(flags.isEnabled("localFlag")).toBe(true);
        expect(flags.isEnabled("remoteFlag")).toBe(true);
        expect(flags.getString("theme")).toBe("dark");
        expect(flags.getString("greeting")).toBe("hello");
        expect(flags.getNumber("pageSize")).toBe(20);
        expect(flags.getNumber("retries")).toBe(3);

        expect(container.resolve(DEP_KEYS.EVENT_RECORDER)).toBe(eventRecorder);
        expect(container.resolve(DEP_KEYS.LOCALE)).toEqual({
            lang: "en-US",
            dir: "ltr",
        });
        expect(container.resolve(DEP_KEYS.PLATFORM)).toBe(platform);
        expect(container.resolve<Translator>(DEP_KEYS.TRANSLATOR).t("hello")).toBe("Hello");

        const loggerFactory = container.resolve<LoggerFactory>(DEP_KEYS.LOGGER_FACTORY);
        expect(loggerFactory.loggerFor("custom")).toBeDefined();

        const logger = container.resolve<Logger>(DEP_KEYS.LOGGER);
        logger.debug("debug");
        logger.warn("warn");
        logger.error("error");

        expect(report).toHaveBeenNthCalledWith(1, "warn", "framework", ["warn"]);
        expect(report).toHaveBeenNthCalledWith(2, "error", "framework", ["error"]);
        expect(warn).toHaveBeenCalled();
        expect(error).toHaveBeenCalled();

        const metrics = container.resolve<MetricsRecorder>(DEP_KEYS.METRICS);
        metrics.recordEvent("Open", { id: "1" });
        expect(info).toHaveBeenCalledWith("[Metrics:Event]", {
            name: "Open",
            id: "1",
        });
    });
});
