import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { IntersectionImpressionObserver } from "../../src/metrics/impression-observer";

type ObserverCallback = (entries: Array<{ target: Element; isIntersecting: boolean }>) => void;

class IntersectionObserverMock {
    static instances: IntersectionObserverMock[] = [];

    readonly observe = vi.fn();
    readonly unobserve = vi.fn();
    readonly disconnect = vi.fn();
    readonly options: { threshold?: number };

    private readonly callback: ObserverCallback;

    constructor(callback: ObserverCallback, options: { threshold?: number }) {
        this.callback = callback;
        this.options = options;
        IntersectionObserverMock.instances.push(this);
    }

    trigger(entries: Array<{ target: Element; isIntersecting: boolean }>): void {
        this.callback(entries);
    }

    static latest(): IntersectionObserverMock {
        const instance = IntersectionObserverMock.instances.at(-1);
        if (!instance) {
            throw new Error("No IntersectionObserverMock instance registered");
        }
        return instance;
    }

    static reset(): void {
        IntersectionObserverMock.instances = [];
    }
}

beforeEach(() => {
    IntersectionObserverMock.reset();
    vi.stubGlobal(
        "IntersectionObserver",
        IntersectionObserverMock as unknown as typeof IntersectionObserver,
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("IntersectionImpressionObserver", () => {
    test("observes and unobserves elements", () => {
        const observer = new IntersectionImpressionObserver();
        const element = {} as Element;
        const io = IntersectionObserverMock.latest();

        observer.observe(element, "hero", { section: "top" });
        observer.unobserve(element);

        expect(io.observe).toHaveBeenCalledWith(element);
        expect(io.unobserve).toHaveBeenCalledWith(element);
        expect(io.options.threshold).toBe(0.5);
    });

    test("captures impressions after an element stays visible long enough", () => {
        const now = vi.spyOn(Date, "now");
        now.mockReturnValueOnce(1000).mockReturnValueOnce(2505);

        const observer = new IntersectionImpressionObserver({
            minVisibleDuration: 1000,
        });
        const element = {} as Element;
        const io = IntersectionObserverMock.latest();

        observer.observe(element, "hero", { section: "top" });
        io.trigger([{ target: element, isIntersecting: true }]);
        io.trigger([{ target: element, isIntersecting: false }]);

        expect(observer.consume()).toEqual([
            {
                id: "hero",
                timestamp: 1000,
                metadata: { section: "top" },
            },
        ]);
    });

    test("flushes currently visible entries during consume and avoids duplicates", () => {
        const now = vi.spyOn(Date, "now");
        now.mockReturnValueOnce(1000).mockReturnValueOnce(2200).mockReturnValueOnce(2250);

        const observer = new IntersectionImpressionObserver({
            minVisibleDuration: 1000,
        });
        const element = {} as Element;
        const io = IntersectionObserverMock.latest();

        observer.observe(element, "card-1");
        io.trigger([{ target: element, isIntersecting: true }]);

        expect(observer.consume()).toEqual([
            {
                id: "card-1",
                timestamp: 1000,
                metadata: undefined,
            },
        ]);
        expect(observer.consume()).toEqual([]);
    });

    test("disconnects and clears all tracked state on destroy", () => {
        const observer = new IntersectionImpressionObserver();
        const element = {} as Element;
        const io = IntersectionObserverMock.latest();

        observer.observe(element, "hero");
        observer.destroy();

        expect(io.disconnect).toHaveBeenCalled();
        expect(observer.consume()).toEqual([]);
    });

    test("ignores untracked entries, keeps the first visible timestamp, and skips short impressions", () => {
        const now = vi.spyOn(Date, "now");
        now.mockReturnValueOnce(1000)
            .mockReturnValueOnce(1100)
            .mockReturnValueOnce(1200)
            .mockReturnValueOnce(1300)
            .mockReturnValueOnce(1500)
            .mockReturnValueOnce(1600);

        const observer = new IntersectionImpressionObserver({
            threshold: 0.75,
            minVisibleDuration: 1000,
        });
        const element = {} as Element;
        const stranger = {} as Element;
        const io = IntersectionObserverMock.latest();

        observer.observe(element, "hero", { section: "top" });
        io.trigger([{ target: stranger, isIntersecting: true }]);
        io.trigger([{ target: element, isIntersecting: false }]);
        io.trigger([{ target: element, isIntersecting: true }]);
        io.trigger([{ target: element, isIntersecting: true }]);
        io.trigger([{ target: element, isIntersecting: false }]);

        expect(observer.consume()).toEqual([]);
        expect(io.options.threshold).toBe(0.75);
    });
});
