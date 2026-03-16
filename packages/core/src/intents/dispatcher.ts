/**
 * IntentDispatcher — Intent 分发器
 *
 * 注册 IntentController，按 intentId 分发。
 */

import type { Container } from "../dependencies/container";
import type { Intent, IntentController } from "./types";

export class IntentDispatcher {
    private controllers = new Map<string, IntentController>();

    /** 注册一个 IntentController */
    register(controller: IntentController): void {
        this.controllers.set(controller.intentId, controller);
    }

    /** 分发 Intent 到对应 Controller */
    async dispatch<T>(intent: Intent<T>, container: Container): Promise<T> {
        const controller = this.controllers.get(intent.id);
        if (!controller) {
            throw new Error(
                `[IntentDispatcher] No controller for "${intent.id}". ` +
                    `Registered: [${Array.from(this.controllers.keys()).join(", ")}]`,
            );
        }
        return controller.perform(intent, container) as Promise<T>;
    }

    /** 检查是否已注册某个 Intent */
    has(intentId: string): boolean {
        return this.controllers.has(intentId);
    }
}
