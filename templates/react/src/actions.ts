import { makeExternalUrlAction, makeFlowAction, type Action } from "@finesoft/front/web";

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

/** Single navigation definition shared by all native views. */
export const NAV_LINKS = [
    { label: "Home", action: NAV_ACTIONS.home, path: "/" },
    { label: "Search", action: NAV_ACTIONS.search, path: "/search" },
    { label: "About", action: NAV_ACTIONS.about, path: "/about" },
    { label: "GitHub", action: NAV_ACTIONS.github, path: null },
] as const;
