/**
 * ConsoleEventRecorder — 控制台输出 metrics，用于开发环境
 */

import type { EventRecorder } from "./types";

export class ConsoleEventRecorder implements EventRecorder {
    private readonly prefix: string;

    constructor(prefix = "Metrics") {
        this.prefix = prefix;
    }

    record(type: string, fields?: Record<string, unknown>): void {
        console.info(`[${this.prefix}:${type}]`, fields ?? "");
    }

    async flush(): Promise<void> {
        // console 不需要 flush
    }

    destroy(): void {
        // 无资源需要释放
    }
}
