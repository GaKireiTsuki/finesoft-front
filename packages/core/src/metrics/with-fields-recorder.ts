/**
 * WithFieldsRecorder — 装饰器，为每条事件自动附加公共字段
 */

import type { EventRecorder, MetricsFieldsProvider } from "./types";

export class WithFieldsRecorder implements EventRecorder {
    constructor(
        private readonly inner: EventRecorder,
        private readonly providers: MetricsFieldsProvider[],
    ) {}

    record(type: string, fields?: Record<string, unknown>): void {
        let merged: Record<string, unknown> = {};
        for (const provider of this.providers) {
            Object.assign(merged, provider.getFields());
        }
        if (fields) {
            Object.assign(merged, fields);
        }
        this.inner.record(type, merged);
    }

    async flush(): Promise<void> {
        return this.inner.flush?.();
    }

    destroy(): void {
        this.inner.destroy?.();
    }
}
