import { makeExternalUrlAction, makeFlowAction, type Action } from "@finesoft/front";

/** 创建指向商品详情的 FlowAction */
export function productDetailAction(id: string): Action {
    return makeFlowAction(`/products/${id}`);
}

/** 导航 Actions */
export const NAV_ACTIONS = {
    home: makeFlowAction("/"),
    search: makeFlowAction("/search"),
    about: makeFlowAction("/about"),
    github: makeExternalUrlAction("https://github.com/nicepkg/finesoft"),
} as const;
