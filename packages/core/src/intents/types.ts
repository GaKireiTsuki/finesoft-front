/**
 * Intent 类型定义
 */

import type { Container } from "../dependencies/container";

/** Intent — 描述一个用户意图 */
export interface Intent<T = unknown> {
    /** Intent 标识符（用于匹配 Controller） */
    id: string;
    /** 意图参数 */
    params?: Record<string, string>;
    /** 预期返回的数据（仅用于类型推断） */
    _returnType?: T;
}

/** Intent Controller — 处理特定 intentId 的业务逻辑 */
export interface IntentController<T = unknown> {
    /** Controller 对应的 Intent ID */
    intentId: string;
    /** 执行意图，返回页面数据 */
    perform(intent: Intent<T>, container: Container): Promise<T> | T;
}
