/**
 * Action 类型定义
 *
 * FlowAction — SPA 内部导航
 * ExternalUrlAction — 打开外部链接
 * CompoundAction — 组合多个 Action
 */

/** Action Kind 常量 */
export const ACTION_KINDS = {
	FLOW: "flow" as const,
	EXTERNAL_URL: "externalUrl" as const,
	COMPOUND: "compound" as const,
};

/** FlowAction — SPA 导航 */
export interface FlowAction {
	kind: typeof ACTION_KINDS.FLOW;
	url: string;
	/** 展示方式: 默认 push，modal 弹窗 */
	presentationContext?: "default" | "modal";
}

/** ExternalUrlAction — 外部链接 */
export interface ExternalUrlAction {
	kind: typeof ACTION_KINDS.EXTERNAL_URL;
	url: string;
}

/** CompoundAction — 组合 Action */
export interface CompoundAction {
	kind: typeof ACTION_KINDS.COMPOUND;
	actions: Action[];
}

/** 所有 Action 的联合类型 */
export type Action = FlowAction | ExternalUrlAction | CompoundAction;

// ===== Type Guards =====

export function isFlowAction(action: Action): action is FlowAction {
	return action.kind === ACTION_KINDS.FLOW;
}

export function isExternalUrlAction(
	action: Action,
): action is ExternalUrlAction {
	return action.kind === ACTION_KINDS.EXTERNAL_URL;
}

export function isCompoundAction(action: Action): action is CompoundAction {
	return action.kind === ACTION_KINDS.COMPOUND;
}

// ===== Factory =====

export function makeFlowAction(
	url: string,
	presentationContext?: FlowAction["presentationContext"],
): FlowAction {
	return { kind: ACTION_KINDS.FLOW, url, presentationContext };
}

export function makeExternalUrlAction(url: string): ExternalUrlAction {
	return { kind: ACTION_KINDS.EXTERNAL_URL, url };
}
