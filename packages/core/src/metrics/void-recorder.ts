/**
 * VoidEventRecorder — 空实现，用于禁用 metrics 的环境
 */

import type { EventRecorder } from "./types";

export class VoidEventRecorder implements EventRecorder {
    record(): void {
        // no-op
    }

    async flush(): Promise<void> {
        // no-op
    }

    destroy(): void {
        // no-op
    }
}
