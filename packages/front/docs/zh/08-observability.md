# 8. 可观测性

三个原语，各自可组合、可替换：

- **`Logger`** —— 行式（debug/info/warn/error）
- **`EventRecorder`** —— 结构化事件记录（`{ name, fields }`）
- **`ReportCallback`** —— 把 `warn`/`error` 日志 fan-out 到外部监控

外加通过 `IntersectionImpressionObserver` 做 impression 追踪。

## Logger

基础的 `ConsoleLogger` 把日志写到 `console.{debug,info,warn,error}`，带分类前缀。Scope 化 logger 加嵌套前缀。

```ts
import { ConsoleLogger } from "@finesoft/front";

const logger = new ConsoleLogger("app");
logger.info("hello"); // [app] hello

const auth = logger.scope("auth");
auth.warn("token expired"); // [app:auth] token expired
```

级别：`debug`、`info`、`warn`、`error`。框架对内部失败（守卫失败、dispatch 错误）会在自己的 logger 上调 `warn`/`error`。

### 替换框架 logger

```ts
import { DEP_KEYS } from "@finesoft/front";

framework.container.register(DEP_KEYS.LOGGER, () => myLogger);
framework.container.register(DEP_KEYS.LOGGER_FACTORY, () => ({
    create(category) {
        return myLoggerImpl.scope(category);
    },
}));
```

## `ReportCallback` —— 把日志转发到监控

把 `warn`/`error` 日志送到 Sentry / Datadog / 自家收集器最干净的方式：

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

工作原理：

- `Framework.create({ reportCallback })` 在 `ConsoleLogger` 上装 `ReportingLoggerFactory`
- 所有 `logger.warn(...)` 和 `logger.error(...)` 调用都触发回调**并且**继续走 console
- `debug` 和 `info` 不转发（避免在量里淹没信号）
- 回调在 `try/catch` 里跑 —— reporter 失败不会让框架崩

### 分类

每个 `logger.scope("auth")` 变成传给回调的 category。用它们在监控系统里做路由：

```ts
reportCallback(level, category, args) {
    if (category.startsWith("auth")) {
        sentry.captureMessage(/* 送到 auth 项目 */);
    } else {
        sentry.captureMessage(/* 默认项目 */);
    }
}
```

### 反爆量

`ReportCallback` 每次都跑。如果你有热循环重复打同一条告警一千次，你会发出一千个 event。在回调里加去重：

```ts
const seen = new Map<string, number>();
const reportCallback: ReportCallback = (level, category, args) => {
    const key = `${category}:${args[0]}`;
    const now = Date.now();
    const last = seen.get(key) ?? 0;
    if (now - last < 60_000) return; // 每个 (category, message) 每分钟最多 1 次
    seen.set(key, now);
    Sentry.captureMessage(/* ... */);
};
```

## `EventRecorder` —— 结构化事件

要带字段的事件而不是自由文本日志时用 `EventRecorder`。

```ts
import { Framework, ConsoleEventRecorder, type EventRecorder } from "@finesoft/front";

const recorder: EventRecorder = new ConsoleEventRecorder();
const framework = Framework.create({ eventRecorder: recorder });

// 任意位置：
recorder.record({
    name: "PageView",
    fields: { url: "/products/42", referrer: "/search?q=widget" },
});
```

### 内置事件

框架通过 `framework.didEnterPage(page)` 自动记录 `PageView`。每次导航成功（SSR + CSR）都触发，字段：`{ intentId, url, renderMode }`。

### 组合 recorder

`CompositeEventRecorder` 把事件分发给多个 sink：

```ts
import { ConsoleEventRecorder, CompositeEventRecorder } from "@finesoft/front";

const recorder = new CompositeEventRecorder([
    new ConsoleEventRecorder(), // dev 可见性
    productionAnalyticsRecorder, // 上送后端
]);
```

一个 recorder 抛错时其他仍然收到事件。

### 添加公共字段

`WithFieldsRecorder` 装饰另一个 recorder，给每个事件前置字段：

```ts
import { WithFieldsRecorder, ConsoleEventRecorder } from "@finesoft/front";

const recorder = new WithFieldsRecorder(new ConsoleEventRecorder(), [
    { getFields: () => ({ app: "myApp", version: "1.0.0" }) },
    { getFields: () => ({ userId: getCurrentUserId() }) },
]);

recorder.record({ name: "Click", fields: { id: "buy" } });
// → { app, version, userId, id }
```

适用于不想在每次 `record()` 调用里重复的 session 级字段。

### 写自己的 recorder

实现 `EventRecorder` 接口：

```ts
import type { EventRecorder, EventRecord } from "@finesoft/front";

class HttpEventRecorder implements EventRecorder {
    constructor(private endpoint: string) {}
    record(event: EventRecord): void {
        // fire-and-forget；不要 await —— record() 不该阻塞 UI
        navigator.sendBeacon(this.endpoint, JSON.stringify(event));
    }
    destroy(): void {
        // flush、关闭连接等
    }
}
```

批处理、重试、生命周期处理见 [高阶 · 自定义 event recorder](./advanced/custom-event-recorder.md)。

## Impression 追踪

通过 `IntersectionObserver` 跟踪元素进入视口：

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

// 元素挂载时绑定
observer.observe(productCardElement, "product-card-123", {
    category: "featured",
    position: 3,
});

// 元素卸载时解绑
observer.unobserve(productCardElement);

// 应用 teardown 时
observer.destroy();
```

observer 对每个元素每次可见性变化触发一次回调。它不会跨 observe/unobserve 循环去重 —— 你的回调决定是否再次记录。

## 通过 `fallback` 处理错误

Controller 错误会自动变成记录的事件：

```ts
class HomeController extends BaseController<{}, HomePage> {
    readonly intentId = "home";

    async execute(_params, container) {
        const api = container.resolve<UserApi>("userApi");
        return { kind: "home", users: await api.list() };
    }

    fallback(_params, error) {
        // 1. 框架通过自己的 logger 记录错误（→ reportCallback）
        // 2. 你返回降级页面
        return { kind: "home", users: [], degraded: true };
    }
}
```

错误时的操作顺序：

1. `execute()` 抛错。
2. `BaseController` catch 之后调 `framework.logger.error("[controller:home]", error)`。
3. Logger 触发 `reportCallback("error", "controller:home", [error])` → Sentry。
4. `fallback()` 返回你设计的 `Page`。
5. 渲染继续，用 fallback 页面（默认 HTTP 200）。

要返回非 200 状态码，让 page 带「错误」标记，在 `afterLoad` 守卫里检查：

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

## 指标（计数器 / gauge / 计时）

框架的 `MetricsClient` 是最小的：

```ts
import { DEP_KEYS } from "@finesoft/front";

const metrics = framework.container.resolve(DEP_KEYS.METRICS);

metrics.increment("requests.total");
metrics.increment("login.failed", { reason: "wrong_password" });
metrics.gauge("queue.depth", 17);
metrics.timing("render.duration", 142);
```

默认实现是 no-op。注册自己的：

```ts
framework.container.register(DEP_KEYS.METRICS, () => new StatsdMetrics(/* ... */));
```

大多数应用 `EventRecorder` 就够 —— 你的分析后端已经把事件聚合成指标了。

## Trace ID 和请求关联

常见模式：给每个日志和事件打上请求级 trace id。

```ts
// beforeLoad 守卫
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

通过 `WithFieldsRecorder` 注册 scope 化的 recorder，让本请求里每个事件自动带 trace id。

## 下一步

- [服务器与部署](./09-server-and-deployment.md) —— 这些原语在 HTTP 层是怎么用的
- [高阶 · 自定义 event recorder](./advanced/custom-event-recorder.md) —— 生产级实现
