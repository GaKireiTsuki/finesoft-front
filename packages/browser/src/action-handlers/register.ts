/**
 * Action Handler 统一注册入口
 */

import type { BasePage, Framework, Logger } from "@finesoft/core";
import { registerExternalUrlHandler } from "./external-url-action";
import { registerFlowActionHandler, type FlowActionCallbacks } from "./flow-action";

export type { FlowActionCallbacks };

export interface ActionHandlerDependencies {
    framework: Framework;
    log: Logger;
    callbacks: FlowActionCallbacks;
    updateApp: (props: { page: Promise<BasePage> | BasePage; isFirstPage?: boolean }) => void;
    /** 获取可滚动页面元素，用于滚动位置保存/恢复 */
    getScrollablePageElement?: () => HTMLElement | null;
    /** 是否由 FlowAction handler 管理 history；结构化导航下传 `false`（见 registerFlowActionHandler）。 */
    manageHistory?: boolean;
}

export function registerActionHandlers(deps: ActionHandlerDependencies): void {
    const { framework, log, callbacks, updateApp } = deps;

    registerFlowActionHandler({
        framework,
        log,
        callbacks,
        updateApp,
        getScrollablePageElement: deps.getScrollablePageElement,
        manageHistory: deps.manageHistory,
    });

    registerExternalUrlHandler({ framework, log });
}
