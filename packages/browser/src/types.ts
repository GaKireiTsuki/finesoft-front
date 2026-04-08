import type { BasePage, Framework } from "@finesoft/core";
import type { KeepAliveController } from "./keep-alive";

export type BrowserNavigationType = "initial" | "navigate" | "redirect" | "popstate";

export interface BrowserMountContext {
    framework: Framework;
    keepAlive: KeepAliveController;
}

export interface BrowserUpdateAppProps {
    page: Promise<BasePage> | BasePage;
    isFirstPage?: boolean;
    cacheKey?: string;
    cacheHit?: boolean;
    navigationType?: BrowserNavigationType;
}
