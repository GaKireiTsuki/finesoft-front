/**
 * CompositeEventRecorder — 将事件广播到多个后端
 */

import type { EventRecorder } from "./types";

export class CompositeEventRecorder implements EventRecorder {
    private readonly recorders: EventRecorder[];

    constructor(recorders: EventRecorder[]) {
        this.recorders = recorders;
    }

    record(type: string, fields?: Record<string, unknown>): void {
        for (const recorder of this.recorders) {
            recorder.record(type, fields);
        }
    }

    async flush(): Promise<void> {
        await Promise.all(this.recorders.map((r) => r.flush?.()));
    }

    destroy(): void {
        for (const recorder of this.recorders) {
            recorder.destroy?.();
        }
    }
}
