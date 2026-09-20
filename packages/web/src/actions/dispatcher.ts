/**
 * ActionDispatcher — Action 分发器
 *
 * 注册不同 kind 的 handler，按类型分发。
 * CompoundAction 自动展开递归执行。
 */

import { ExecutionError } from "@finesoft/core";
import type { Action, ActionInvocation } from "./types";
import { isCompoundAction } from "./types";

/** Action 处理器函数类型 */
export type ActionHandler<A extends Action = Action, Result = void> = (
    action: A,
    invocation?: ActionInvocation,
) => Promise<Result | void> | Result | void;

/** CompoundAction 最大递归展开深度 */
const MAX_COMPOUND_DEPTH = 32;
interface ActionGroup {
    generation: number;
}

export class ActionDispatcher<Result = void> {
    private handlers = new Map<string, ActionHandler<Action, Result>>();
    private closed = false;
    private epoch = 0;
    private invocations = new WeakMap<ActionInvocation, ActionGroup>();
    private pendingFlow?: ActionGroup;

    constructor(private readonly currentResult?: () => Result) {}

    get generation(): number {
        return this.epoch;
    }

    /** Cancel pending groups; a handler may retain its own invocation during URL admission. */
    cancel = (invocation?: ActionInvocation): void => {
        this.epoch++;
        const current = invocation && this.invocations.get(invocation);
        if (current) current.generation = this.epoch;
    };

    /**
     * 注册指定 kind 的 handler。
     *
     * 重复 kind 时保留第一个注册者并发出警告——这是有意设计：
     * framework 内部 handler 先注册，应用层意外覆盖会被记录而非静默生效。
     * 如需显式替换，先调用 removeAction(kind)。
     */
    onAction = <A extends Action>(kind: string, handler: ActionHandler<A, Result>): void => {
        if (this.handlers.has(kind)) {
            console.warn(`[ActionDispatcher] kind="${kind}" already registered, skipping`);
            return;
        }
        this.handlers.set(kind, handler as ActionHandler<Action, Result>);
    };

    /** 移除指定 kind 的 handler（用于显式覆盖场景） */
    removeAction = (kind: string): boolean => {
        return this.handlers.delete(kind);
    };

    close(): void {
        this.closed = true;
        this.epoch++;
        this.handlers.clear();
        this.pendingFlow = undefined;
    }

    /** 执行一个 Action（CompoundAction 递归展开，有深度限制） */
    perform = (action: Action, invocation?: ActionInvocation): Promise<Result> =>
        this.dispatch(action, invocation, 0);

    private async dispatch(
        action: Action,
        invocation: ActionInvocation | undefined,
        depth: number,
    ): Promise<Result> {
        const existing = invocation && this.invocations.get(invocation);
        const context = existing ? invocation! : { ...invocation };
        const group = existing ?? { generation: this.epoch };
        if (!existing) this.invocations.set(context, group);
        let flow = false;
        try {
            if (group.generation !== this.epoch) throw new ExecutionError("cancelled");
            if (this.closed)
                throw new ExecutionError("configuration", "Action dispatcher is closed");
            if (isCompoundAction(action)) {
                if (depth >= MAX_COMPOUND_DEPTH) {
                    throw new Error(
                        `[ActionDispatcher] CompoundAction recursion depth exceeded (max ${MAX_COMPOUND_DEPTH})`,
                    );
                }
                for (const subAction of action.actions) {
                    if (context.signal?.aborted) throw new ExecutionError("cancelled");
                    const result = await this.dispatch(subAction, context, depth + 1);
                    // An uncommitted navigation result terminates the sequence before later effects.
                    if (this.currentResult && result !== this.currentResult()) return result;
                }
                return this.currentResult?.() as Result;
            }

            const handler = this.handlers.get(action.kind);
            if (!handler) {
                console.warn(`[ActionDispatcher] No handler for kind="${action.kind}"`);
                return this.currentResult?.() as Result;
            }

            flow = action.kind === "flow" && action.presentationContext !== "modal";
            const navigation = flow || (action.kind !== "flow" && action.kind !== "externalUrl");
            // A URL may still be resolving outside the transaction queue. A competing
            // navigation invalidates that group without cancelling serialized tree edits.
            if (navigation && this.pendingFlow && this.pendingFlow !== group) {
                this.pendingFlow.generation = -1;
                this.pendingFlow = undefined;
            }
            if (flow) this.pendingFlow = group;
            const result = await handler(action, context);
            return result === undefined ? (this.currentResult?.() as Result) : result;
        } finally {
            if (flow && this.pendingFlow === group) this.pendingFlow = undefined;
            if (!existing) this.invocations.delete(context);
        }
    }
}
