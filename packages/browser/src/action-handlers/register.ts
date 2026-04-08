/**
 * Action Handler 统一注册入口
 */

import type { Framework, Logger } from "@finesoft/core";
import { registerExternalUrlHandler } from "./external-url-action";
import type { KeepAliveController } from "../keep-alive";
import { registerFlowActionHandler, type FlowActionCallbacks } from "./flow-action";
import type { BrowserUpdateAppProps } from "../types";

export type { FlowActionCallbacks };

export interface ActionHandlerDependencies {
    framework: Framework;
    log: Logger;
    callbacks: FlowActionCallbacks;
    updateApp: (props: BrowserUpdateAppProps) => void;
    keepAlive: KeepAliveController;
    /** 获取可滚动页面元素，用于滚动位置保存/恢复 */
    getScrollablePageElement?: () => HTMLElement | null;
}

export function registerActionHandlers(deps: ActionHandlerDependencies): void {
    const { framework, log, callbacks, updateApp, keepAlive } = deps;

    registerFlowActionHandler({
        framework,
        log,
        callbacks,
        updateApp,
        keepAlive,
        getScrollablePageElement: deps.getScrollablePageElement,
    });

    registerExternalUrlHandler({ framework, log });
}
