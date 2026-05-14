# 高阶：自定义 event recorder

构建生产级的 `EventRecorder`，做批处理、重试、跨导航存活。本配方假设你已经读了[第 8 章：可观测性](../08-observability.md)。

## 目标

好 recorder 的特性：

- **不阻塞。** `record()` 同步返回；传输后台进行。
- **批处理。** 每 N 个事件或 T 秒一个 HTTP 请求，不是每个事件一个。
- **跨导航存活。** unload 时通过 `sendBeacon` flush 待发事件。
- **优雅降级。** 网络失败不让应用崩；发不出去的事件不无限堆积。
- **生命周期感知。** `destroy()` flush 所有待发事件后销毁。

## 骨架

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
            // 溢出保护 —— 丢最旧，控内存
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
                // 4xx —— 丢。5xx —— 放回队头。
                if (resp.status >= 500) this.queue.unshift(...batch);
            }
        } catch {
            // 网络失败 —— 放回队头
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

## 每块为什么存在

### `keepalive: true`

告诉浏览器即使页面正在导航离开也要完成请求。有 body 大小上限（~64 KB）但能跨导航。配 `sendBeacon` 处理 unload —— beacon 更小更可靠。

### `pagehide` 和 `beforeunload`

`pagehide` 在页面进 bfcache（前进/后退）时触发。`beforeunload` 在常规导航/关闭时触发。两者都该 flush 待发事件。有些浏览器只触发一个，所以两个都监听。

### `keepalive` vs `sendBeacon`

| 方法                   | body 上限 | 返回响应？ | 时机                   |
| ---------------------- | --------- | ---------- | ---------------------- |
| `fetch(..keepalive)`   | ~64KB     | 是         | 页面生命中的周期 flush |
| `navigator.sendBeacon` | ~64KB     | 否         | unload 时最终 flush    |

两个都用：周期 `fetch` 看成功/失败，`sendBeacon` 作为最后逃生口。

### 5xx 放回，4xx 丢

5xx 是服务端错 —— 之后重试。4xx 是你错 —— 重试无用，无限重试会冲垮服务器。丢 batch 继续。

### 溢出保护

网络挂几小时，应用还在发事件，队列无界增长。`maxQueueSize` 限制；新事件来时最旧的掉。这是用完整性换内存安全 —— 按你能丢多少 vs 能用多少内存挑大小。

## 接上

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

`CompositeEventRecorder` 包两个，事件**同时**送到 console（dev 可见）**和**后端。

## 加横切字段

用 `WithFieldsRecorder` 装饰附加 session 级字段：

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

`getFields` **每个事件**跑一次，所以事件之间的用户状态变化能正确反映。

## 服务端记录

框架对每个 SSR 请求记录 `PageView`。要在服务端捕获：

```ts
// src/ssr.ts
import { createSSRRender } from "@finesoft/front";
import { HttpEventRecorder } from "./lib/recorders/http-recorder";

// 跨所有 SSR 请求共享的单实例 recorder
const serverRecorder = new HttpEventRecorder({
    endpoint: "https://internal-events.example/v1/events",
    batchSize: 100, // 服务端更激进的批量
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

服务端 recorder 应该：

- 跨请求共享单实例（别按请求构造）
- 用大 batch / 长 flush 间隔（没 UI 要阻塞）
- 把 `destroy()` 接进优雅关闭，在途事件能 flush

## 与 Sentry / Datadog 集成

同时用 `ReportCallback`（送 `warn`/`error` 到 Sentry）和 `EventRecorder`（送结构化事件到后端）的话，分开：

```ts
Framework.create({
    reportCallback: (level, category, args) => {
        Sentry.captureMessage(`[${category}] ${args.join(" ")}`, level);
    },
    eventRecorder: new CompositeEventRecorder([
        new HttpEventRecorder({ endpoint: "/api/events" }),
        // 可选：也转给 Datadog
        new DatadogEventRecorder({ apiKey: env.DD_API_KEY }),
    ]),
});
```

不同 sink 不同用途 —— 错误送 Sentry triage，结构化事件送数据仓库做分析。别想着一个 recorder 包办两件。

## 采样

高流量应用要采样事件：

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
// 记 10% 的事件
```

在 recorder 层采样，不在调用点 —— 调用点不该知道是否被采样。

## 测试

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

        // 模拟下一次 flush
        await (recorder as any).flush();

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
```

## 参考

- [第 8 章：可观测性](../08-observability.md) —— 基础原语和内置事件
- 框架自己的 composite / with-fields recorder：`packages/core/src/metrics/`
