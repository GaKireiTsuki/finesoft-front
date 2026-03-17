/**
 * ActionDispatcher — Action 分发器
 *
 * 注册不同 kind 的 handler，按类型分发。
 * CompoundAction 自动展开递归执行。
 */

import type { Action } from "./types";
import { isCompoundAction } from "./types";

/** Action 处理器函数类型 */
export type ActionHandler<A extends Action = Action> = (action: A) => Promise<void> | void;

/** CompoundAction 最大递归展开深度 */
const MAX_COMPOUND_DEPTH = 32;

export class ActionDispatcher {
    private handlers = new Map<string, ActionHandler>();

    /** 注册指定 kind 的 handler（防止重复注册） */
    onAction<A extends Action>(kind: string, handler: ActionHandler<A>): void {
        if (this.handlers.has(kind)) {
            console.warn(`[ActionDispatcher] kind="${kind}" already registered, skipping`);
            return;
        }
        this.handlers.set(kind, handler as ActionHandler);
    }

    /** 执行一个 Action（CompoundAction 递归展开，有深度限制） */
    async perform(action: Action, _depth = 0): Promise<void> {
        if (isCompoundAction(action)) {
            if (_depth >= MAX_COMPOUND_DEPTH) {
                throw new Error(
                    `[ActionDispatcher] CompoundAction recursion depth exceeded (max ${MAX_COMPOUND_DEPTH})`,
                );
            }
            for (const subAction of action.actions) {
                await this.perform(subAction, _depth + 1);
            }
            return;
        }

        const handler = this.handlers.get(action.kind);
        if (!handler) {
            console.warn(`[ActionDispatcher] No handler for kind="${action.kind}"`);
            return;
        }

        await handler(action);
    }
}
