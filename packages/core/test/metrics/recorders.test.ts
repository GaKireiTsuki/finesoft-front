import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { CompositeEventRecorder } from "../../src/metrics/composite-recorder";
import { ConsoleEventRecorder } from "../../src/metrics/console-recorder";
import { VoidEventRecorder } from "../../src/metrics/void-recorder";
import { WithFieldsRecorder } from "../../src/metrics/with-fields-recorder";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("metrics recorders", () => {
    test("ConsoleEventRecorder logs events with the configured prefix", async () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        const recorder = new ConsoleEventRecorder("Telemetry");

        recorder.record("Click", { id: 1 });
        await recorder.flush();
        recorder.destroy();

        expect(info).toHaveBeenCalledWith("[Telemetry:Click]", { id: 1 });
    });

    test("CompositeEventRecorder broadcasts records and delegates lifecycle hooks", async () => {
        const first = {
            record: vi.fn(),
            flush: vi.fn(async () => {}),
            destroy: vi.fn(),
        };
        const second = {
            record: vi.fn(),
            flush: vi.fn(async () => {}),
            destroy: vi.fn(),
        };
        const recorder = new CompositeEventRecorder([first, second]);

        recorder.record("Load", { page: "home" });
        await recorder.flush();
        recorder.destroy();

        expect(first.record).toHaveBeenCalledWith("Load", { page: "home" });
        expect(second.record).toHaveBeenCalledWith("Load", { page: "home" });
        expect(first.flush).toHaveBeenCalled();
        expect(second.flush).toHaveBeenCalled();
        expect(first.destroy).toHaveBeenCalled();
        expect(second.destroy).toHaveBeenCalled();
    });

    test("WithFieldsRecorder merges provider output and delegates flush/destroy", async () => {
        const inner = {
            record: vi.fn(),
            flush: vi.fn(async () => {}),
            destroy: vi.fn(),
        };
        const recorder = new WithFieldsRecorder(inner, [
            { getFields: () => ({ app: "front" }) },
            { getFields: () => ({ locale: "en-US" }) },
        ]);

        recorder.record("View", { page: "home" });
        await recorder.flush();
        recorder.destroy();

        expect(inner.record).toHaveBeenCalledWith("View", {
            app: "front",
            locale: "en-US",
            page: "home",
        });
        expect(inner.flush).toHaveBeenCalled();
        expect(inner.destroy).toHaveBeenCalled();
    });

    test("VoidEventRecorder is a harmless no-op", async () => {
        const recorder = new VoidEventRecorder();

        expect(() => recorder.record()).not.toThrow();
        await expect(recorder.flush()).resolves.toBeUndefined();
        expect(() => recorder.destroy()).not.toThrow();
    });
});
