/**
 * Svelte Context 集成 — Framework 实例的 Svelte context 传递
 *
 * 在根组件（App.svelte）中调用 setFrameworkContext，
 * 子组件通过 getPerform 获取 perform 函数，无需逐层传递 onaction 回调。
 */

import type { Action } from "@finesoft/front";
import { Framework } from "@finesoft/front";
import { getContext, setContext } from "svelte";

const FRAMEWORK_KEY = "framework";

/** 在根组件初始化时设置 Framework 实例到 Svelte context */
export function setFrameworkContext(framework: Framework): void {
    setContext(FRAMEWORK_KEY, framework);
}

/** 获取 Framework 实例；SSR 或未设置时返回 undefined */
export function getFramework(): Framework | undefined {
    return getContext<Framework | undefined>(FRAMEWORK_KEY);
}

/**
 * 获取 perform 函数，供导航/操作类组件在事件处理器中调用。
 * 在组件初始化阶段（<script> 顶层）调用，不能在事件回调内调用。
 *
 * @returns perform 函数；SSR 或无 context 时返回 undefined
 */
export function getPerform(): ((action: Action) => Promise<void>) | undefined {
    const fw = getFramework();
    if (!fw) return undefined;
    return (action: Action) => fw.perform(action);
}
