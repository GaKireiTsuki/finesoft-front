# 8. Observability

Three primitives, each composable, each replaceable:

- **`Logger`** — line-oriented (debug/info/warn/error)
- **`EventRecorder`** — structured event records (`{ name, fields }`)
- **`ReportCallback`** — fan-out of `warn`/`error` logs to external monitoring

Plus impression tracking via `IntersectionImpressionObserver`.

## Logger

The base `ConsoleLogger` writes to `console.{debug,info,warn,error}` with a category prefix. Scoped loggers add nested prefixes.

```ts
import { ConsoleLogger } from "@finesoft/front";

const logger = new ConsoleLogger("app");
logger.info("hello"); // [app] hello

const auth = logger.scope("auth");
auth.warn("token expired"); // [app:auth] token expired
```

Levels: `debug`, `info`, `warn`, `error`. The framework calls `warn`/`error` on its own logger for internal failures (failed guards, dispatch errors).

### Replacing the framework logger

```ts
import { DEP_KEYS } from "@finesoft/front";

framework.container.register(DEP_KEYS.LOGGER, () => myLogger);
framework.container.register(DEP_KEYS.LOGGER_FACTORY, () => ({
    create(category) {
        return myLoggerImpl.scope(category);
    },
}));
```

## `ReportCallback` — forwarding logs to monitoring

The cleanest way to ship `warn`/`error` logs to Sentry / Datadog / your own collector:

```ts
import { Framework, type ReportCallback } from "@finesoft/front";

const reportCallback: ReportCallback = (level, category, args) => {
    Sentry.captureMessage(`[${category}] ${args.join(" ")}`, level);
};

const framework = Framework.create({
    reportCallback,
    // ...
});
```

How it works:

- `Framework.create({ reportCallback })` installs `ReportingLoggerFactory` over `ConsoleLogger`
- All `logger.warn(...)` and `logger.error(...)` calls fire the callback **and** continue to the console
- `debug` and `info` are not forwarded (avoid burying signal in volume)
- The callback runs inside `try/catch` — a failure in the reporter cannot crash the framework

### Categories

Each `logger.scope("auth")` becomes a category passed to the callback. Use them for routing in your monitoring system:

```ts
reportCallback(level, category, args) {
    if (category.startsWith("auth")) {
        sentry.captureMessage(/* go to auth project */);
    } else {
        sentry.captureMessage(/* default project */);
    }
}
```

### Anti-spam

`ReportCallback` runs every time. If you have a hot loop logging the same warning a thousand times, you'll send a thousand events. Add deduplication in the callback itself:

```ts
const seen = new Map<string, number>();
const reportCallback: ReportCallback = (level, category, args) => {
    const key = `${category}:${args[0]}`;
    const now = Date.now();
    const last = seen.get(key) ?? 0;
    if (now - last < 60_000) return; // 1 per minute per (category, message)
    seen.set(key, now);
    Sentry.captureMessage(/* ... */);
};
```

## `EventRecorder` — structured events

When you want events with fields, not free-form log lines, use `EventRecorder`.

```ts
import { Framework, ConsoleEventRecorder, type EventRecorder } from "@finesoft/front";

const recorder: EventRecorder = new ConsoleEventRecorder();
const framework = Framework.create({ eventRecorder: recorder });

// Anywhere:
recorder.record({
    name: "PageView",
    fields: { url: "/products/42", referrer: "/search?q=widget" },
});
```

### Built-in events

The framework records `PageView` automatically via `framework.didEnterPage(page)`. This fires:

- After every successful navigation (SSR + CSR)
- With fields: `{ intentId, url, renderMode }`

### Composing recorders

`CompositeEventRecorder` fans events to multiple sinks:

```ts
import { ConsoleEventRecorder, CompositeEventRecorder } from "@finesoft/front";

const recorder = new CompositeEventRecorder([
    new ConsoleEventRecorder(), // dev visibility
    productionAnalyticsRecorder, // ship to backend
]);
```

If one recorder throws, the others still receive the event.

### Adding common fields

`WithFieldsRecorder` decorates another recorder, prepending fields to every event:

```ts
import { WithFieldsRecorder, ConsoleEventRecorder } from "@finesoft/front";

const recorder = new WithFieldsRecorder(new ConsoleEventRecorder(), [
    { getFields: () => ({ app: "myApp", version: "1.0.0" }) },
    { getFields: () => ({ userId: getCurrentUserId() }) },
]);

recorder.record({ name: "Click", fields: { id: "buy" } });
// → { app, version, userId, id }
```

Use this for session-scoped fields you don't want to repeat in every `record()` call.

### Building your own recorder

Implement the `EventRecorder` interface:

```ts
import type { EventRecorder, EventRecord } from "@finesoft/front";

class HttpEventRecorder implements EventRecorder {
    constructor(private endpoint: string) {}
    record(event: EventRecord): void {
        // fire-and-forget; do NOT await — record() shouldn't block UI
        navigator.sendBeacon(this.endpoint, JSON.stringify(event));
    }
    destroy(): void {
        // flush, close connections, etc.
    }
}
```

See [advanced/custom-event-recorder](./advanced/custom-event-recorder.md) for batching, retries, and lifecycle handling.

## Impression tracking

Track when elements enter the viewport using `IntersectionObserver` plumbing:

```ts
import { IntersectionImpressionObserver, type EventRecorder } from "@finesoft/front";

const observer = new IntersectionImpressionObserver((entries) => {
    for (const entry of entries) {
        recorder.record({
            name: "Impression",
            fields: { id: entry.id, ...entry.metadata },
        });
    }
});

// Attach to an element when it mounts
observer.observe(productCardElement, "product-card-123", {
    category: "featured",
    position: 3,
});

// Detach when it unmounts
observer.unobserve(productCardElement);

// On app teardown
observer.destroy();
```

The observer fires the callback once per element per visibility transition. It does not deduplicate across observe/unobserve cycles — your callback should decide whether to record again.

## Error handling via `fallback`

A controller error becomes a recorded event automatically:

```ts
class HomeController extends BaseController<{}, HomePage> {
    readonly intentId = "home";

    async execute(_params, container) {
        const api = container.resolve<UserApi>("userApi");
        return { kind: "home", users: await api.list() };
    }

    fallback(_params, error) {
        // 1. framework logs the error via its logger (→ reportCallback)
        // 2. you return a degraded page
        return { kind: "home", users: [], degraded: true };
    }
}
```

Order of operations on error:

1. `execute()` throws.
2. `BaseController` catches, calls `framework.logger.error("[controller:home]", error)`.
3. Logger fires `reportCallback("error", "controller:home", [error])` → Sentry.
4. `fallback()` returns a `Page` of your design.
5. Render proceeds with the fallback page (HTTP 200 by default).

To set a non-200 status, return a page with an "error" marker and check it in an `afterLoad` guard:

```ts
afterLoad: [
    (ctx) => {
        if ("degraded" in ctx.page && ctx.page.degraded) {
            return deny(503, "Service degraded");
        }
        return next();
    },
],
```

## Metrics (counters / gauges / timing)

The framework's `MetricsClient` is minimal:

```ts
import { DEP_KEYS } from "@finesoft/front";

const metrics = framework.container.resolve(DEP_KEYS.METRICS);

metrics.increment("requests.total");
metrics.increment("login.failed", { reason: "wrong_password" });
metrics.gauge("queue.depth", 17);
metrics.timing("render.duration", 142);
```

The default implementation is a no-op. Register your own:

```ts
framework.container.register(DEP_KEYS.METRICS, () => new StatsdMetrics(/* ... */));
```

For most apps, `EventRecorder` is enough — your analytics backend already aggregates events into metrics.

## Trace IDs and request correlation

A common pattern: tag every log and event with a per-request trace id.

```ts
// beforeLoad guard
function traceIdGuard(ctx) {
    const traceId = ctx.getHeader("x-request-id") ?? crypto.randomUUID();
    ctx.container.register("traceId", () => traceId);
    ctx.container.register(
        DEP_KEYS.EVENT_RECORDER,
        () => new WithFieldsRecorder(baseRecorder, [{ getFields: () => ({ traceId }) }]),
    );
    return next();
}
```

Register the scoped recorder via `WithFieldsRecorder` so every event in this request automatically carries the trace id.

## Next

- [Server & deployment](./09-server-and-deployment.md) — where these primitives meet HTTP
- [Advanced: custom event recorder](./advanced/custom-event-recorder.md) — production-grade implementation
