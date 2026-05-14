# Advanced: custom event recorder

Build a production-grade `EventRecorder` that batches, retries, and survives navigation. This recipe assumes you've read [chapter 8: observability](../08-observability.md).

## Goals

A good recorder:

- **Doesn't block.** `record()` returns synchronously; transmission happens in the background.
- **Batches.** One HTTP request per N events or T seconds, not per event.
- **Survives navigation.** Pending events flush on page unload via `sendBeacon`.
- **Drops gracefully.** Network failures don't crash the app; events that fail to send don't pile up forever.
- **Lifecycle-aware.** `destroy()` flushes everything before disposal.

## Skeleton

```ts
// src/lib/recorders/http-recorder.ts
import type { EventRecorder, EventRecord } from "@finesoft/front";

export interface HttpRecorderOptions {
    endpoint: string;
    batchSize?: number;
    flushIntervalMs?: number;
    maxQueueSize?: number;
}

export class HttpEventRecorder implements EventRecorder {
    private queue: EventRecord[] = [];
    private timer: ReturnType<typeof setInterval> | null = null;
    private flushing = false;
    private readonly opts: Required<HttpRecorderOptions>;

    constructor(options: HttpRecorderOptions) {
        this.opts = {
            batchSize: 50,
            flushIntervalMs: 5000,
            maxQueueSize: 1000,
            ...options,
        };

        if (typeof window !== "undefined") {
            this.timer = setInterval(() => this.flush(), this.opts.flushIntervalMs);
            window.addEventListener("pagehide", this.beaconFlush);
            window.addEventListener("beforeunload", this.beaconFlush);
        }
    }

    record(event: EventRecord): void {
        if (this.queue.length >= this.opts.maxQueueSize) {
            // overflow protection — drop the oldest to bound memory
            this.queue.shift();
        }
        this.queue.push(event);
        if (this.queue.length >= this.opts.batchSize) {
            void this.flush();
        }
    }

    destroy(): void {
        if (this.timer) clearInterval(this.timer);
        if (typeof window !== "undefined") {
            window.removeEventListener("pagehide", this.beaconFlush);
            window.removeEventListener("beforeunload", this.beaconFlush);
        }
        this.beaconFlush();
    }

    private async flush(): Promise<void> {
        if (this.flushing || this.queue.length === 0) return;
        this.flushing = true;
        const batch = this.queue.splice(0, this.opts.batchSize);

        try {
            const resp = await fetch(this.opts.endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(batch),
                keepalive: true,
            });
            if (!resp.ok) {
                // 4xx — drop. 5xx — re-queue at the front.
                if (resp.status >= 500) this.queue.unshift(...batch);
            }
        } catch {
            // network failure — re-queue
            this.queue.unshift(...batch);
        } finally {
            this.flushing = false;
        }
    }

    private beaconFlush = (): void => {
        if (this.queue.length === 0) return;
        if (typeof navigator === "undefined" || !navigator.sendBeacon) return;
        const batch = this.queue.splice(0, this.queue.length);
        navigator.sendBeacon(this.opts.endpoint, JSON.stringify(batch));
    };
}
```

## Why each piece exists

### `keepalive: true`

Tells the browser the request should complete even if the page is navigating away. Has a max body size (~64 KB) but works across navigation. Pair with `sendBeacon` for unload — beacons are smaller and more reliable for that case.

### `pagehide` and `beforeunload`

`pagehide` fires when the page enters the bfcache (back/forward navigation). `beforeunload` fires on regular navigation/close. Both should flush pending events. Some browsers fire one and not the other, so listen for both.

### `keepalive` vs `sendBeacon`

| Method                 | Body limit | Returns response? | When                            |
| ---------------------- | ---------- | ----------------- | ------------------------------- |
| `fetch(..keepalive)`   | ~64KB      | Yes               | Periodic flush during page life |
| `navigator.sendBeacon` | ~64KB      | No                | Final flush on unload           |

Use both: periodic `fetch` for visibility into successes/failures, `sendBeacon` as the final escape hatch.

### Re-queue on 5xx, drop on 4xx

A 5xx is the server's fault — retry later. A 4xx is your fault — retrying won't help, and infinite retry would flood the server. Drop the batch and move on.

### Overflow protection

If the network is down for hours and your app keeps emitting events, the queue would grow without bound. `maxQueueSize` caps it; oldest events drop when new ones arrive. This trades completeness for memory safety — pick the size based on how much you can afford to lose vs how much memory you can spend.

## Wiring it up

```ts
// src/main.ts
import { startBrowserApp, CompositeEventRecorder, ConsoleEventRecorder } from "@finesoft/front/browser";
import { bootstrap } from "./bootstrap";
import { HttpEventRecorder } from "./lib/recorders/http-recorder";

startBrowserApp({
    bootstrap,
    frameworkConfig: {
        eventRecorder: new CompositeEventRecorder([
            new ConsoleEventRecorder(),
            new HttpEventRecorder({
                endpoint: "/api/events",
                batchSize: 50,
                flushIntervalMs: 5000,
            }),
        ]),
    },
    mount: /* ... */,
});
```

The `CompositeEventRecorder` wraps both so events go to console (for dev visibility) **and** to your backend.

## Adding cross-cutting fields

Decorate with `WithFieldsRecorder` to attach session-level fields:

```ts
import { WithFieldsRecorder, type FieldProvider } from "@finesoft/front";

const sessionFields: FieldProvider = {
    getFields: () => ({
        sessionId: getSessionId(),
        appVersion: __APP_VERSION__,
        userAgent: navigator.userAgent,
    }),
};

const userFields: FieldProvider = {
    getFields: () => {
        const user = getCurrentUser();
        return user ? { userId: user.id, role: user.role } : {};
    },
};

new WithFieldsRecorder(new HttpEventRecorder({ endpoint: "/api/events" }), [
    sessionFields,
    userFields,
]);
```

`getFields` runs **per event**, so user-state changes between events reflect correctly.

## Server-side recording

The framework records `PageView` for every SSR request. If you want to capture those server-side:

```ts
// src/ssr.ts
import { createSSRRender } from "@finesoft/front";
import { HttpEventRecorder } from "./lib/recorders/http-recorder";

// Single recorder shared across all SSR requests
const serverRecorder = new HttpEventRecorder({
    endpoint: "https://internal-events.example/v1/events",
    batchSize: 100, // server batches more aggressively
    flushIntervalMs: 1000,
});

export const render = createSSRRender({
    bootstrap,
    frameworkConfig: {
        eventRecorder: serverRecorder,
    },
    /* ... */
});

process.on("SIGTERM", () => serverRecorder.destroy());
```

Server-side recorders should:

- Share a single instance across requests (don't construct per-request)
- Use a larger batch / longer flush interval (no UI to block)
- Wire `destroy()` into graceful shutdown so in-flight events flush

## Integration with Sentry / Datadog

If you use both a `ReportCallback` (for `warn`/`error` logs to Sentry) and an `EventRecorder` (for structured events to your backend), keep them separate:

```ts
Framework.create({
    reportCallback: (level, category, args) => {
        Sentry.captureMessage(`[${category}] ${args.join(" ")}`, level);
    },
    eventRecorder: new CompositeEventRecorder([
        new HttpEventRecorder({ endpoint: "/api/events" }),
        // Optionally: forward to Datadog too
        new DatadogEventRecorder({ apiKey: env.DD_API_KEY }),
    ]),
});
```

Different sinks for different purposes — errors go to Sentry for triage, structured events go to your warehouse for analytics. Don't try to make one recorder do both.

## Sampling

For high-traffic apps, sample events:

```ts
class SamplingRecorder implements EventRecorder {
    constructor(
        private inner: EventRecorder,
        private rate: number,
    ) {}
    record(event: EventRecord): void {
        if (Math.random() < this.rate) this.inner.record(event);
    }
    destroy(): void {
        this.inner.destroy?.();
    }
}

new SamplingRecorder(new HttpEventRecorder({ endpoint: "/api/events" }), 0.1);
// Records 10% of events
```

Sample at the recorder level, not the call site — call sites shouldn't know whether they're being sampled.

## Testing

```ts
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { HttpEventRecorder } from "./http-recorder";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("HttpEventRecorder", () => {
    test("flushes when batch fills", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        const recorder = new HttpEventRecorder({
            endpoint: "/api/events",
            batchSize: 3,
            flushIntervalMs: 60_000,
        });

        recorder.record({ name: "A", fields: {} });
        recorder.record({ name: "B", fields: {} });
        recorder.record({ name: "C", fields: {} });

        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toHaveLength(3);
    });

    test("re-queues batch on 5xx", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(null, { status: 503 }))
            .mockResolvedValueOnce(new Response(null, { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        const recorder = new HttpEventRecorder({
            endpoint: "/api/events",
            batchSize: 1,
            flushIntervalMs: 60_000,
        });

        recorder.record({ name: "A", fields: {} });
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        // simulate the next flush
        await (recorder as any).flush();

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
```

## Related

- [Chapter 8: Observability](../08-observability.md) — base primitives and built-in events
- The framework's own composite/with-fields recorders: `packages/core/src/metrics/`
