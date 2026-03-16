/**
 * ActionDispatcher — Action 分发器
 *
 * 注册不同 kind 的 handler，按类型分发。
 * CompoundAction 自动展开递归执行。
 */

import type { Action } from "./types";
import { isCompoundAction } from "./types";

/** Action 处理器函数类型 */
export type ActionHandler<A extends Action = Action> = (
	action: A,
) => Promise<void> | void;

export class ActionDispatcher {
	private handlers = new Map<string, ActionHandler>();
	private wiredActions = new Set<string>();

	/** 注册指定 kind 的 handler（防止重复注册） */
	onAction<A extends Action>(kind: string, handler: ActionHandler<A>): void {
		if (this.wiredActions.has(kind)) {
			console.warn(
				`[ActionDispatcher] kind="${kind}" already registered, skipping`,
			);
			return;
		}
		this.wiredActions.add(kind);
		this.handlers.set(kind, handler as ActionHandler);
	}

	/** 执行一个 Action（CompoundAction 递归展开） */
	async perform(action: Action): Promise<void> {
		if (isCompoundAction(action)) {
			for (const subAction of action.actions) {
				await this.perform(subAction);
			}
			return;
		}

		const handler = this.handlers.get(action.kind);
		if (!handler) {
			console.warn(
				`[ActionDispatcher] No handler for kind="${action.kind}"`,
			);
			return;
		}

		await handler(action);
	}
}
